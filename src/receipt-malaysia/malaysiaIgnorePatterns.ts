import { businessLabels, footerLabels, metadataLabels, paymentLabels } from './malaysiaReceiptKeywords';

export function isNoiseLine(line: string) {
  const compact = line.replace(/\s/g, '');
  return footerLabels.test(line) || paymentLabels.test(line) || metadataLabels.test(line) || businessLabels.test(line)
    || /\b(?:auth\s*code|approval\s*code|aid|rrn|card\s*(?:no|number)|mid|tid|merchant\s*id|terminal\s*id|payment\s*id)\b/i.test(line)
    || /(?:\+?60[-\s]?\d{1,2}[-\s]?\d{6,8}|\b0\d{1,2}-\d{6,8}\b|\*{3,}\d{4})/.test(compact)
    || /^\d{8,}$/.test(compact) || /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}(?:\s+.*)?$/.test(line) || /^\d{1,2}:\d{2}(?:\s*[AP]M)?$/i.test(line);
}
