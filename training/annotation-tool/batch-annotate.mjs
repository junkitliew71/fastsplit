const args = new Set(process.argv.slice(2));
const shouldWrite = args.has('--write');
const overwrite = args.has('--overwrite');
const baseUrl = 'http://127.0.0.1:4179';

const ITEM_LABELS = ['ITEM_NAME', 'QUANTITY', 'UNIT_PRICE', 'LINE_TOTAL'];
const SUMMARY_LABELS = ['SUBTOTAL', 'SERVICE_CHARGE', 'TAX', 'DISCOUNT', 'ROUNDING', 'GRAND_TOTAL'];

const normalize = value => String(value || '')
  .normalize('NFKC')
  .replace(/[|]/g, 'I')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase();

const centerX = token => token.bbox.x + token.bbox.width / 2;
const centerY = token => token.bbox.y + token.bbox.height / 2;
const median = values => {
  if (!values.length) return 12;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function numericFragments(text) {
  const clean = normalize(text).replace(/,/g, '').replace(/\bRM\s*/g, '');
  return [...clean.matchAll(/(?<![A-Z0-9])[-+]?(?:\d{1,7}(?:\.\d{1,3})|\.\d{2})(?!\d)/g)]
    .map(match => Number(match[0]))
    .filter(Number.isFinite);
}

function moneyValue(token) {
  if (!token) return null;
  const values = numericFragments(token.text);
  if (!values.length) return null;
  return values.at(-1);
}

function isMoneyToken(token) {
  if (!token) return false;
  const text = normalize(token.text);
  return /(?:^|\s)(?:RM\s*)?[-+]?\d[\d,]*\.\d{2,3}(?:\s|$|[A-Z])/.test(text)
    || /(?:^|\s)-?RM\s*\d/.test(text);
}

function quantityValue(token) {
  if (!token) return null;
  const text = normalize(token.text);
  const match = text.match(/^(\d{1,4})(?:\.0+)?\s*(?:X|PC|PCS|UNIT|UNITS|EA)?$/);
  return match ? Number(match[1]) : null;
}

const headerConcept = text => {
  const value = normalize(text);
  let score = 0;
  if (/\b(?:DESCRIPTION|DESC|ITEM|PRODUCT)\b/.test(value)) score++;
  if (/\b(?:QTY|QUANTITY)\b/.test(value)) score++;
  if (/\b(?:PRICE|RATE|RSP|U\/P|UNIT PRICE)\b/.test(value)) score++;
  if (/\b(?:AMOUNT|TOTAL)\b/.test(value)) score++;
  return score;
};

const isSummaryText = text => {
  const value = normalize(text);
  return /\b(?:SUB\s*TOTAL|TOTAL\s+AMOUNT|GRAND\s+TOTAL|TOTAL\s+(?:INCL|EXCL)|NET\s+TOTAL|DISCOUNT|GST|SST|SERVICE\s*(?:CHARGE|TAX)|ROUND(?:ING)?|CASH|CHANGE|PAYMENT|AMOUNT\s+DUE|BALANCE\s+DUE)\b/.test(value);
};

const isDescriptionText = token => {
  const value = normalize(token.text);
  if (!/[A-Z]/.test(value) || isSummaryText(value) || headerConcept(value) >= 2) return false;
  if (/^(?:SR|S|Z|T|GST|SST|RM|MYR|QTY|PCS?|EA|N\/A)$/.test(value)) return false;
  if (/^(?:TEL|FAX|DATE|TIME|CASHIER|INVOICE|RECEIPT|TABLE|ORDER|SALESPERSON|ADDRESS)\b/.test(value)) return false;
  return true;
};

function groupRows(tokens) {
  const tolerance = Math.max(5, median(tokens.map(token => token.bbox.height).filter(Boolean)) * 0.72);
  const rows = [];
  for (const token of [...tokens].sort((a, b) => centerY(a) - centerY(b) || centerX(a) - centerX(b))) {
    const y = centerY(token);
    let row = rows.find(candidate => Math.abs(candidate.y - y) <= tolerance);
    if (!row) { row = { y, tokens: [] }; rows.push(row); }
    row.tokens.push(token);
    row.y = row.tokens.reduce((sum, item) => sum + centerY(item), 0) / row.tokens.length;
  }
  rows.forEach(row => row.tokens.sort((a, b) => centerX(a) - centerX(b)));
  return rows.sort((a, b) => a.y - b.y);
}

function findHeaderY(rows, maxY) {
  const candidates = rows.map(row => ({
    row,
    concepts: new Set(row.tokens.flatMap(token => {
      const text = normalize(token.text);
      return [
        /\b(?:DESCRIPTION|DESC|ITEM|PRODUCT)\b/.test(text) && 'item',
        /\b(?:QTY|QUANTITY)\b/.test(text) && 'qty',
        /\b(?:PRICE|RATE|RSP|U\/P|UNIT PRICE)\b/.test(text) && 'price',
        /\b(?:AMOUNT|TOTAL)\b/.test(text) && 'amount',
      ].filter(Boolean);
    })),
  })).filter(entry => entry.concepts.size >= 2 && entry.row.y < maxY * 0.82);
  return candidates[0]?.row.y ?? maxY * 0.18;
}

function findNumericRows(rows, headerY, maxY) {
  const results = [];
  for (const row of rows) {
    if (row.y <= headerY || row.y >= maxY * 0.9) continue;
    const joined = row.tokens.map(token => token.text).join(' ');
    if (isSummaryText(joined)) continue;
    const money = row.tokens.filter(isMoneyToken).map(token => ({ token, value: moneyValue(token) })).filter(entry => entry.value !== null).sort((a, b) => centerX(a.token) - centerX(b.token));
    if (money.length < 1) continue;
    const line = money.at(-1);
    const unit = money.length >= 2 ? money.at(-2) : null;
    const priceAnchor = unit?.token || line.token;
    const quantities = row.tokens
      .map(token => ({ token, value: quantityValue(token) }))
      .filter(entry => entry.value !== null && centerX(entry.token) < centerX(priceAnchor))
      .sort((a, b) => Math.abs(centerX(priceAnchor) - centerX(a.token)) - Math.abs(centerX(priceAnchor) - centerX(b.token)));
    const quantity = quantities[0] || null;
    if (quantity && (quantity.value <= 0 || quantity.value > 9999)) continue;
    const sameRowDescription = row.tokens.some(token => !isMoneyToken(token) && quantityValue(token) === null && isDescriptionText(token) && centerX(token) < centerX(line.token));
    if (!quantity && !sameRowDescription) continue;
    results.push({ y: row.y, row, quantity, unit, line });
  }
  return results;
}

function inferDescriptions(tokens, numericRows, headerY, summaryY) {
  if (!numericRows.length) return [];
  const tolerance = Math.max(6, median(tokens.map(token => token.bbox.height).filter(Boolean)) * 0.8);
  const firstY = numericRows[0].y;
  const secondY = numericRows[1]?.y ?? summaryY;
  const before = tokens.filter(token => centerY(token) > headerY + tolerance && centerY(token) < firstY - tolerance / 2 && isDescriptionText(token));
  const after = tokens.filter(token => centerY(token) > firstY + tolerance / 2 && centerY(token) < secondY - tolerance / 2 && isDescriptionText(token));
  const nearestBefore = before.length ? Math.min(...before.map(token => firstY - centerY(token))) : Infinity;
  const nearestAfter = after.length ? Math.min(...after.map(token => centerY(token) - firstY)) : Infinity;
  const direction = nearestBefore <= nearestAfter ? 'before' : 'after';
  const used = new Set();
  return numericRows.map((numeric, index) => {
    const previousY = index ? numericRows[index - 1].y : headerY;
    const nextY = index + 1 < numericRows.length ? numericRows[index + 1].y : summaryY;
    const low = direction === 'before' ? previousY + tolerance / 2 : numeric.y - tolerance;
    const high = direction === 'before' ? numeric.y + tolerance : nextY - tolerance / 2;
    const unitX = centerX((numeric.unit || numeric.line).token);
    const rowTokenIds = new Set(numeric.row.tokens.map(token => token.id));
    const sameRow = numeric.row.tokens.filter(token => !used.has(token.id) && !isMoneyToken(token) && quantityValue(token) === null && isDescriptionText(token) && centerX(token) < centerX(numeric.line.token));
    const candidates = tokens.filter(token => {
      if (used.has(token.id) || rowTokenIds.has(token.id) || !isDescriptionText(token)) return false;
      const y = centerY(token);
      return y >= low && y <= high && centerX(token) < unitX;
    });
    const combined = [...sameRow, ...candidates];
    for (const token of combined) used.add(token.id);
    return combined.sort((a, b) => centerY(a) - centerY(b) || centerX(a) - centerX(b));
  });
}

function summaryLabel(text) {
  const value = normalize(text);
  if (/\b(?:SERVICE\s*(?:CHARGE|TAX)|SVC\s*(?:CHG|CHARGE))\b/.test(value)) return 'SERVICE_CHARGE';
  if (/\bDISCOUNT\b|\bDISC\.?\b/.test(value)) return 'DISCOUNT';
  if (/\bROUND(?:ING)?\b|ROUND\s+AMT|ROUNDING\s+ADJUSTMENT/.test(value)) return 'ROUNDING';
  if (/\b(?:GST|SST|TAX)\b/.test(value) && !/(?:GST\s*(?:NO|ID|SUMMARY)|TAX\s+(?:INVOICE|CODE))/.test(value)) return 'TAX';
  if (/\bSUB\s*TOTAL\b|\bTOTAL\s+(?:EXCLUD|EXCL|BEFORE\s+TAX|AMOUNT)\b/.test(value)) return 'SUBTOTAL';
  if (/\b(?:GRAND\s+TOTAL|NET\s+TOTAL|AMOUNT\s+DUE|BALANCE\s+DUE)\b/.test(value)) return 'GRAND_TOTAL';
  if (/^\s*(?:TOTAL|TOTAL\s*\([^)]*\))\s*:?\s*(?:RM)?\s*$/i.test(tokenTextWithoutAmount(value))) return 'GRAND_TOTAL';
  return null;
}

function tokenTextWithoutAmount(text) {
  return text.replace(/(?:RM\s*)?[-+]?\d[\d,]*\.\d{2,3}.*$/i, '').trim();
}

function valueTokenForLabel(labelToken, tokens, rowTolerance) {
  if (isMoneyToken(labelToken)) return labelToken;
  const y = centerY(labelToken);
  const right = tokens.filter(token => token.id !== labelToken.id && isMoneyToken(token) && centerX(token) > centerX(labelToken) && Math.abs(centerY(token) - y) <= rowTolerance)
    .sort((a, b) => centerX(b) - centerX(a));
  return right[0] || null;
}

function matchEntityTotalToken(tokens, total, minY, maxY) {
  const target = Number(String(total || '').replace(/,/g, ''));
  if (!Number.isFinite(target)) return null;
  const candidates = tokens.filter(token => {
    const value = moneyValue(token);
    return value !== null && Math.abs(value - target) <= 0.011 && centerY(token) > minY;
  });
  if (!candidates.length) return null;
  return candidates.sort((a, b) => {
    const aPenalty = centerY(a) > maxY * 0.93 ? 100000 : 0;
    const bPenalty = centerY(b) > maxY * 0.93 ? 100000 : 0;
    return (b.bbox.width + centerY(b) - aPenalty) - (a.bbox.width + centerY(a) - bPenalty);
  })[0];
}

function closeEnough(left, right) {
  return Math.abs(left - right) <= Math.max(0.055, Math.abs(right) * 0.006);
}

function buildAnnotation(payload) {
  const tokens = payload.tokens;
  const maxY = Math.max(...tokens.map(token => token.bbox.y + token.bbox.height));
  const rows = groupRows(tokens);
  const headerY = findHeaderY(rows, maxY);
  let numericRows = findNumericRows(rows, headerY, maxY);
  const summaryCandidates = tokens.filter(token => isSummaryText(token.text) && centerY(token) > headerY + 10);
  const summaryY = summaryCandidates.length ? Math.min(...summaryCandidates.map(centerY)) : maxY * 0.84;
  numericRows = numericRows.filter(row => row.y < summaryY + 2);
  const descriptions = inferDescriptions(tokens, numericRows, headerY, summaryY);
  const assignments = [];
  const items = [];
  const used = new Set();
  const add = (label, tokenIds, itemId) => {
    const unique = [...new Set(tokenIds)].filter(id => !used.has(id));
    if (!unique.length) return;
    unique.forEach(id => used.add(id));
    assignments.push({ label, tokenIds: unique, ...(itemId ? { itemId } : {}) });
  };

  numericRows.forEach((row, index) => {
    const nameTokens = descriptions[index] || [];
    if (!nameTokens.length) return;
    const itemId = `item-${String(items.length + 1).padStart(3, '0')}`;
    items.push({ id: itemId, assignmentIds: [] });
    add('ITEM_NAME', nameTokens.map(token => token.id), itemId);
    if (row.quantity) add('QUANTITY', [row.quantity.token.id], itemId);
    if (row.unit) add('UNIT_PRICE', [row.unit.token.id], itemId);
    add('LINE_TOTAL', [row.line.token.id], itemId);
  });

  const rowTolerance = Math.max(8, median(tokens.map(token => token.bbox.height).filter(Boolean)) * 1.1);
  const summaryFound = new Map();
  for (const token of tokens.filter(token => centerY(token) >= summaryY - rowTolerance)) {
    const label = summaryLabel(token.text);
    if (!label || label === 'GRAND_TOTAL' || summaryFound.has(label)) continue;
    const valueToken = valueTokenForLabel(token, tokens, rowTolerance);
    if (valueToken && !used.has(valueToken.id)) summaryFound.set(label, valueToken);
  }
  for (const label of SUMMARY_LABELS.filter(label => label !== 'GRAND_TOTAL')) {
    const token = summaryFound.get(label);
    if (token) add(label, [token.id]);
  }
  const grandToken = matchEntityTotalToken(tokens, payload.entities?.total, summaryY - rowTolerance, maxY);
  if (grandToken) {
    const previous = assignments.find(assignment => assignment.tokenIds.includes(grandToken.id));
    if (previous && !previous.itemId) {
      previous.label = 'GRAND_TOTAL';
    } else if (!previous) add('GRAND_TOTAL', [grandToken.id]);
  }

  add('OTHER', tokens.filter(token => !used.has(token.id)).map(token => token.id));

  const itemMath = items.map(item => {
    const fields = Object.fromEntries(assignments.filter(a => a.itemId === item.id).map(a => [a.label, a]));
    const tokenFor = label => tokens.find(token => fields[label]?.tokenIds.includes(token.id));
    const quantity = quantityValue(tokenFor('QUANTITY'));
    const unit = moneyValue(tokenFor('UNIT_PRICE'));
    const line = moneyValue(tokenFor('LINE_TOTAL'));
    return quantity !== null && unit !== null && line !== null && closeEnough(quantity * unit, line);
  });
  const lineSum = items.reduce((sum, item) => {
    const assignment = assignments.find(a => a.itemId === item.id && a.label === 'LINE_TOTAL');
    const token = tokens.find(candidate => assignment?.tokenIds.includes(candidate.id));
    return sum + (moneyValue(token) ?? 0);
  }, 0);
  const fieldValue = label => {
    const assignment = assignments.find(a => a.label === label && !a.itemId);
    const token = tokens.find(candidate => assignment?.tokenIds.includes(candidate.id));
    return moneyValue(token);
  };
  const subtotal = fieldValue('SUBTOTAL');
  const tax = fieldValue('TAX') ?? 0;
  const service = fieldValue('SERVICE_CHARGE') ?? 0;
  const discount = Math.abs(fieldValue('DISCOUNT') ?? 0);
  const rounding = fieldValue('ROUNDING') ?? 0;
  const grand = fieldValue('GRAND_TOTAL');
  const lineMathValid = items.length > 0 && itemMath.filter(Boolean).length / items.length >= 0.8;
  const subtotalValid = subtotal !== null && closeEnough(lineSum, subtotal);
  const grandFromSummaryValid = grand !== null && subtotal !== null && closeEnough(subtotal + tax + service - discount + rounding, grand);
  const grandFromLinesValid = grand !== null && closeEnough(lineSum + tax + service - discount + rounding, grand);
  const confident = items.length > 0 && Boolean(grandToken) && lineMathValid && (grandFromSummaryValid || grandFromLinesValid || subtotalValid);
  const notes = [
    'Geometry-and-math assisted annotation generated from original OCR boxes; no OCR text was invented.',
    `${items.length} item group(s); ${itemMath.filter(Boolean).length}/${items.length} item equations valid.`,
    `lineSum=${lineSum.toFixed(2)}; subtotal=${subtotal ?? 'missing'}; grandTotal=${grand ?? 'missing'}.`,
    confident ? 'Validation passed.' : 'Needs human review because layout or totals were ambiguous.',
  ].join(' ');
  return { status: confident ? 'complete' : 'unclear', assignments, items, notes, diagnostics: { lineMathValid, subtotalValid, grandFromSummaryValid, grandFromLinesValid } };
}

async function main() {
  const indexResponse = await fetch(`${baseUrl}/api/index`);
  if (!indexResponse.ok) throw new Error(`Annotation server unavailable at ${baseUrl}`);
  const index = await indexResponse.json();
  const stats = { total: 0, skippedExisting: 0, complete: 0, unclear: 0, items: 0, noItems: 0, noGrandTotal: 0, invalidItemMath: 0, invalidTotals: 0, errors: [] };
  for (const receipt of index.receipts) {
    if (!overwrite && index.statuses[receipt.key] !== 'unlabeled') { stats.skippedExisting++; continue; }
    try {
      const response = await fetch(`${baseUrl}/api/receipt?key=${encodeURIComponent(receipt.key)}`);
      if (!response.ok) throw new Error(`Could not load ${receipt.key}`);
      const payload = await response.json();
      const annotation = buildAnnotation(payload);
      stats.total++;
      stats[annotation.status]++;
      stats.items += annotation.items.length;
      if (!annotation.items.length) stats.noItems++;
      if (!annotation.assignments.some(item => item.label === 'GRAND_TOTAL')) stats.noGrandTotal++;
      if (!annotation.diagnostics.lineMathValid) stats.invalidItemMath++;
      if (!(annotation.diagnostics.grandFromSummaryValid || annotation.diagnostics.grandFromLinesValid || annotation.diagnostics.subtotalValid)) stats.invalidTotals++;
      if (shouldWrite) {
        const save = await fetch(`${baseUrl}/api/annotation?key=${encodeURIComponent(receipt.key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(annotation),
        });
        if (!save.ok) throw new Error(`${receipt.key}: ${(await save.json()).error || save.statusText}`);
      }
    } catch (error) {
      stats.errors.push({ receipt: receipt.key, error: error.message });
    }
  }
  console.log(JSON.stringify({ mode: shouldWrite ? 'write' : 'dry-run', ...stats }, null, 2));
  if (stats.errors.length) process.exitCode = 1;
}

await main();
