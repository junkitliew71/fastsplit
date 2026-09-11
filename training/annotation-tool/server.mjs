import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';

const ITEM_LABELS = new Set(['ITEM_NAME', 'QUANTITY', 'UNIT_PRICE', 'LINE_TOTAL']);
const RECEIPT_LABELS = new Set(['SUBTOTAL', 'SERVICE_CHARGE', 'TAX', 'DISCOUNT', 'ROUNDING', 'GRAND_TOTAL']);
const ALL_LABELS = new Set([...ITEM_LABELS, ...RECEIPT_LABELS, 'OTHER']);
const VALID_STATUSES = new Set(['draft', 'complete', 'skipped', 'unclear']);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const annotationRoot = path.resolve(scriptDir, '../fastsplit_annotations');
const publicRoot = path.resolve(scriptDir, 'public');
const args = process.argv.slice(2);
const datasetFlag = args.indexOf('--dataset');
const requestedDataset = datasetFlag >= 0 ? args[datasetFlag + 1] : path.resolve(scriptDir, '../dataset');
const portFlag = args.indexOf('--port');
const port = Number(portFlag >= 0 ? args[portFlag + 1] : 4179);

if (!requestedDataset || !existsSync(requestedDataset)) {
  console.error(`Dataset not found: ${requestedDataset || '(missing --dataset value)'}`);
  console.error('Pass an extracted dataset directory or archive.zip with --dataset.');
  process.exit(1);
}

const normalize = value => value.replaceAll('\\', '/').replace(/^\/+/, '');
const contentType = file => ({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
}[path.extname(file).toLowerCase()] || 'application/octet-stream');

class DirectoryDataset {
  constructor(root) { this.root = path.resolve(root); this.names = []; }
  async initialize() {
    const walk = async dir => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(absolute);
        else this.names.push(normalize(path.relative(this.root, absolute)));
      }
    };
    await walk(this.root);
  }
  resolve(name) {
    const target = path.resolve(this.root, normalize(name));
    if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) throw new Error('Invalid dataset path.');
    return target;
  }
  read(name) { return readFile(this.resolve(name)); }
}

class ZipDataset {
  constructor(file) { this.file = file; this.names = []; this.entries = new Map(); this.zip = null; }
  async initialize() {
    this.zip = await new Promise((resolve, reject) => yauzl.open(this.file, { lazyEntries: true, autoClose: false }, (error, zip) => error ? reject(error) : resolve(zip)));
    await new Promise((resolve, reject) => {
      this.zip.on('entry', entry => { const name = normalize(entry.fileName); if (!name.endsWith('/')) { this.names.push(name); this.entries.set(name, entry); } this.zip.readEntry(); });
      this.zip.once('end', resolve); this.zip.once('error', reject); this.zip.readEntry();
    });
  }
  async read(name) {
    const entry = this.entries.get(normalize(name));
    if (!entry) throw new Error(`Dataset entry not found: ${name}`);
    return new Promise((resolve, reject) => this.zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      const chunks = []; stream.on('data', chunk => chunks.push(chunk)); stream.once('end', () => resolve(Buffer.concat(chunks))); stream.once('error', reject);
    }));
  }
}

const datasetInfo = await stat(requestedDataset);
const dataset = datasetInfo.isDirectory() ? new DirectoryDataset(requestedDataset) : new ZipDataset(requestedDataset);
await dataset.initialize();

const imagePattern = /^(.*?)(?:\/)?(train|test)\/img\/([^/]+)\.jpe?g$/i;
const receipts = dataset.names.flatMap(name => {
  const match = name.match(imagePattern);
  if (!match) return [];
  const [, , split, id] = match;
  const base = name.slice(0, name.lastIndexOf('/img/'));
  return [{
    key: `${split}/${id}`, id, split: split.toLowerCase(),
    image: name, boxes: `${base}/box/${id}.txt`, entities: `${base}/entities/${id}.txt`,
  }];
}).sort((a, b) => a.split.localeCompare(b.split) || a.id.localeCompare(b.id));
const receiptByKey = new Map(receipts.map(receipt => [receipt.key, receipt]));

function parseBoxes(text) {
  return text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    const parts = line.split(',');
    const coordinates = parts.slice(0, 8).map(Number);
    const polygon = [[coordinates[0], coordinates[1]], [coordinates[2], coordinates[3]], [coordinates[4], coordinates[5]], [coordinates[6], coordinates[7]]];
    const xs = polygon.map(point => point[0]); const ys = polygon.map(point => point[1]);
    return {
      id: `t${String(index + 1).padStart(4, '0')}`,
      text: parts.slice(8).join(','), polygon,
      bbox: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
    };
  });
}

const annotationPath = receipt => path.join(annotationRoot, receipt.split, `${receipt.id}.json`);
async function readAnnotation(receipt) {
  try { return JSON.parse(await readFile(annotationPath(receipt), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function statuses() {
  const pairs = await Promise.all(receipts.map(async receipt => [receipt.key, (await readAnnotation(receipt))?.status || 'unlabeled']));
  return Object.fromEntries(pairs);
}

async function receiptPayload(receipt) {
  const [boxBuffer, entityBuffer, annotation] = await Promise.all([dataset.read(receipt.boxes), dataset.read(receipt.entities), readAnnotation(receipt)]);
  const tokens = parseBoxes(boxBuffer.toString('utf8'));
  let entities = {}; try { entities = JSON.parse(entityBuffer.toString('utf8')); } catch { entities = { _raw: entityBuffer.toString('utf8') }; }
  return { receipt, imageUrl: `/api/image?key=${encodeURIComponent(receipt.key)}`, tokens, entities, annotation };
}

function validateAndNormalize(body, receipt, tokens, previous) {
  if (!body || typeof body !== 'object') throw new Error('Annotation must be a JSON object.');
  if (!VALID_STATUSES.has(body.status)) throw new Error('Invalid annotation status.');
  if (!Array.isArray(body.assignments) || !Array.isArray(body.items)) throw new Error('assignments and items must be arrays.');
  const tokenMap = new Map(tokens.map(token => [token.id, token]));
  const usedTokens = new Set(); const assignmentIds = new Set(); const itemIds = new Set(body.items.map(item => item.id));
  const assignments = body.assignments.map((assignment, index) => {
    if (!ALL_LABELS.has(assignment.label)) throw new Error(`Invalid label: ${assignment.label}`);
    if (!Array.isArray(assignment.tokenIds) || !assignment.tokenIds.length) throw new Error('Every assignment needs at least one token.');
    for (const tokenId of assignment.tokenIds) {
      if (!tokenMap.has(tokenId)) throw new Error(`Unknown original token: ${tokenId}`);
      if (usedTokens.has(tokenId)) throw new Error(`Original token assigned more than once: ${tokenId}`);
      usedTokens.add(tokenId);
    }
    if (ITEM_LABELS.has(assignment.label) && (!assignment.itemId || !itemIds.has(assignment.itemId))) throw new Error(`${assignment.label} requires a valid item group.`);
    if (RECEIPT_LABELS.has(assignment.label) && assignment.itemId) throw new Error(`${assignment.label} cannot belong to an item group.`);
    const id = assignment.id || `a${String(index + 1).padStart(3, '0')}`;
    if (assignmentIds.has(id)) throw new Error(`Duplicate assignment id: ${id}`); assignmentIds.add(id);
    return { id, label: assignment.label, tokenIds: [...new Set(assignment.tokenIds)], text: assignment.tokenIds.map(id => tokenMap.get(id).text).join(' '), ...(assignment.itemId ? { itemId: assignment.itemId } : {}) };
  });
  const items = body.items.map(item => ({ id: item.id, assignmentIds: assignments.filter(assignment => assignment.itemId === item.id).map(assignment => assignment.id) }));
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, receiptId: receipt.id, split: receipt.split,
    source: { image: receipt.image, boxes: receipt.boxes, entities: receipt.entities },
    status: body.status, assignments, items, notes: String(body.notes || ''),
    createdAt: previous?.createdAt || now, updatedAt: now,
  };
}

function json(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); }
function collectBody(request) { return new Promise((resolve, reject) => { const chunks = []; let size = 0; request.on('data', chunk => { size += chunk.length; if (size > 5_000_000) { reject(new Error('Request too large.')); request.destroy(); } else chunks.push(chunk); }); request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); request.on('error', reject); }); }

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && url.pathname === '/api/index') return json(response, 200, { count: receipts.length, receipts, statuses: await statuses() });
    if (request.method === 'GET' && url.pathname === '/api/receipt') {
      const receipt = receiptByKey.get(url.searchParams.get('key'));
      if (!receipt) return json(response, 404, { error: 'Receipt not found.' });
      return json(response, 200, await receiptPayload(receipt));
    }
    if (request.method === 'GET' && url.pathname === '/api/image') {
      const receipt = receiptByKey.get(url.searchParams.get('key'));
      if (!receipt) return json(response, 404, { error: 'Receipt not found.' });
      const image = await dataset.read(receipt.image); response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' }); return response.end(image);
    }
    if (request.method === 'POST' && url.pathname === '/api/annotation') {
      const receipt = receiptByKey.get(url.searchParams.get('key'));
      if (!receipt) return json(response, 404, { error: 'Receipt not found.' });
      const body = JSON.parse(await collectBody(request)); const payload = await receiptPayload(receipt);
      const annotation = validateAndNormalize(body, receipt, payload.tokens, payload.annotation);
      await mkdir(path.dirname(annotationPath(receipt)), { recursive: true });
      await writeFile(annotationPath(receipt), `${JSON.stringify(annotation, null, 2)}\n`, 'utf8');
      return json(response, 200, annotation);
    }
    if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
    const relative = url.pathname === '/' ? 'index.html' : normalize(url.pathname);
    const target = path.resolve(publicRoot, relative);
    if (target !== publicRoot && !target.startsWith(`${publicRoot}${path.sep}`)) return json(response, 403, { error: 'Forbidden.' });
    if (!existsSync(target)) return json(response, 404, { error: 'Not found.' });
    response.writeHead(200, { 'Content-Type': contentType(target) }); createReadStream(target).pipe(response);
  } catch (error) { console.error(error); if (!response.headersSent) json(response, 400, { error: error.message }); else response.destroy(); }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`FastSplit annotation tool: http://127.0.0.1:${port}`);
  console.log(`Dataset: ${path.resolve(requestedDataset)} (${receipts.length} receipts)`);
  console.log(`Annotations: ${annotationRoot}`);
});
