import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { extractFields, recognizeId } from '../server/ocr.js';

describe('Lokale Ausweiserkennung', () => {
  it('liest die Beschriftungen eines RP-Ausweises und ignoriert das Ablaufdatum', () => {
    assert.deepEqual(extractFields('PERSONAL AUSWEIS\nABLAUFDATUM:\n19.03.2029\nNAME:\nAlex Sommer\nGESCHLECHT:\nmännlich\nGEBURTSDATUM:\n2004/08/04\nGRÖSSE:\n182'),
      { name: 'Alex Sommer', birthDate: '2004-08-04' });
  });
  it('erkennt Inline-Felder und deutsche Datumsformate', () => {
    assert.deepEqual(extractFields('Name: Anna Müller\nGeburtsdatum: 04.08.2004'), { name: 'Anna Müller', birthDate: '2004-08-04' });
  });
  it('ignoriert dekorative Rahmenzeichen vor den Feldbeschriftungen', () => {
    assert.deepEqual(extractFields('\\ | NAME:\nAlex Sommer\n| |\n| | GEBURTSDATUM:\n| | 2004/08/04'),
      { name: 'Alex Sommer', birthDate: '2004-08-04' });
    assert.deepEqual(extractFields('N | NAME: {\nAlex Sommer\n| | GEBURTSDATUM:\n| } | 2004/08/04'),
      { name: 'Alex Sommer', birthDate: '2004-08-04' });
  });
  it('erfindet keine Namen oder Geburtsdaten und akzeptiert keine ungültigen Kalenderdaten', () => {
    assert.deepEqual(extractFields('ABLAUFDATUM:\n19.03.2029\nNAME:\nGESCHLECHT:\nmännlich\nGEBURTSDATUM:\n2004/02/30'), { name: '', birthDate: '' });
  });
  it('führt echte OCR mit lokal installierten deutschen Sprachdaten aus', { timeout: 60000 }, async () => {
    const svg = Buffer.from(`<svg width="1000" height="350" xmlns="http://www.w3.org/2000/svg">
      <rect width="1000" height="350" fill="white"/>
      <g fill="black" font-family="Arial" font-size="40">
        <text x="40" y="70">NAME: Alex Sommer</text>
        <text x="40" y="160">GEBURTSDATUM: 2004/08/04</text>
      </g></svg>`);
    const image = await sharp(svg).png().toBuffer();
    const text = await recognizeId(image);
    assert.deepEqual(extractFields(text), { name: 'Alex Sommer', birthDate: '2004-08-04' }, text);
  });
});
