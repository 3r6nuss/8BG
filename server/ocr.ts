import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

export interface ExtractedFields { name: string; birthDate: string }

function normalizeDate(value: string): string {
  const match = value.match(/\b(\d{4})[./-](\d{2})[./-](\d{2})\b/)
    ?? value.match(/\b(\d{2})[./-](\d{2})[./-](\d{4})\b/);
  if (!match) return '';
  const [, a, b, c] = match;
  if (!a || !b || !c) return '';
  const iso = a.length === 4 ? `${a}-${b}-${c}` : `${c}-${b}-${a}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso ? iso : '';
}

export function extractFields(text: string): ExtractedFields {
  const lines = text.split(/\r?\n/).map(line => line.trim().replace(/^[^\p{L}\p{N}]+/u, '').trim()).filter(Boolean);
  let name = '';
  let birthDate = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const nameLabel = line.match(/(?:^|[\s|])(?:name|vor.? und nachname)\b\s*[:;|]?\s*(.*)$/i);
    if (!name && nameLabel) {
      const inline = (nameLabel[1] ?? '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
      const candidate = inline || lines[i + 1] || '';
      if (/^[\p{L}][\p{L}\s.'’-]{2,99}$/u.test(candidate) && !/geschlecht|geburt|personal/i.test(candidate)) {
        name = candidate;
      }
    }
    if (!birthDate && /geburt|birth|born/i.test(line)) {
      birthDate = normalizeDate(line) || normalizeDate(lines[i + 1] || '');
    }
  }
  return { name, birthDate };
}

export async function recognizeId(image: Buffer): Promise<string> {
  const require = createRequire(import.meta.url);
  const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/deu/package.json')), '4.0.0');
  const worker = await createWorker('deu', 1, {
    langPath,
    cacheMethod: 'none',
    gzip: true,
    errorHandler: error => console.error('OCR-Worker:', error),
  });
  try {
    const prepared = await sharp(image).resize({ width: 1800 }).grayscale().normalize().png().toBuffer();
    const result = await worker.recognize(prepared);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}
