import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { renderQuotePdf } from '../../lib/quote-builder/pdf.mjs';
import { calculateQuote, formatMoney } from '../../tools/quote-builder/domain.mjs';

function input(overrides = {}) {
  return {
    customer: { name: 'Jordan Green', address: '24 Garden Street, Melbourne VIC 3000', email: 'jordan@example.com', phone: '0400 111 222' },
    business: { name: 'Green Ground Landscaping', email: 'hello@example.com', phone: '03 9000 1234', abn: '12 345 678 901' },
    reference: 'LS-20261103-0042', issueDate: '2026-11-03', validDays: 30,
    scope: 'Remove the old lawn and install new turf to the confirmed front garden area.',
    exclusions: 'Irrigation repairs and hidden underground obstructions.',
    catalogue: [{ id: 'turf', name: 'Turf supply and installation', unit: 'm²', rateCents: 3500 }],
    items: [{ id: 'private-item-id', serviceId: 'turf', quantity: '24.5', description: 'Supply and install the selected turf.', confirmed: true }],
    taxRateBps: 1000, scopeConfirmed: true, ratesConfirmed: true,
    ...overrides,
  };
}

// Read the actual embedded-font text in the resulting document, rather than
// checking a separate representation that could disagree with the rendered PDF.
function extractedPages(document) {
  const decodeStream = stream => Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  return document.getPages().map(page => {
    const fontResources = page.node.Resources().lookup(PDFName.of('Font'), PDFDict);
    const maps = new Map();
    for (const [name, reference] of fontResources.entries()) {
      const font = document.context.lookup(reference, PDFDict);
      const unicode = decodeStream(font.lookup(PDFName.of('ToUnicode'), PDFRawStream));
      const characters = new Map();
      for (const block of unicode.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const match of block[1].matchAll(/<([a-f\d]+)>\s*<([a-f\d]+)>/gi)) {
          const units = match[2].match(/.{4}/g).map(unit => Number.parseInt(unit, 16));
          characters.set(match[1].toUpperCase(), String.fromCharCode(...units));
        }
      }
      maps.set(name.toString().slice(1), characters);
    }
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
    const text = [];
    let currentFont;
    for (const streamReference of streams) {
      const stream = document.context.lookup(streamReference, PDFRawStream);
      for (const match of decodeStream(stream).matchAll(/\/([^\s/]+)\s+[\d.]+\s+Tf|<([a-f\d]+)>\s*Tj/gi)) {
        if (match[1]) currentFont = maps.get(match[1]);
        else text.push((match[2].match(/.{4}/g) ?? []).map(code => currentFont.get(code.toUpperCase()) ?? '').join(''));
      }
    }
    return text.join('\n');
  });
}

test('exports a valid customer quote with embedded brand fonts and exact calculated amounts', async () => {
  const quote = calculateQuote(input());
  const original = structuredClone(quote);
  const bytes = await renderQuotePdf(quote);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
  assert.equal(document.getTitle(), `Quote ${quote.reference}`);
  const text = extractedPages(document).join('\n');
  for (const value of ['Green Ground Landscaping', 'Jordan Green', '24 Garden Street,', '12 345 678 901', quote.reference, quote.issueDate, quote.validUntil, 'Scope of work', 'Exclusions', 'GST (10%)', 'TOTAL AUD', formatMoney(quote.items[0].rateCents), formatMoney(quote.items[0].lineTotalCents), formatMoney(quote.subtotalCents), formatMoney(quote.taxCents), formatMoney(quote.totalCents)]) {
    assert.ok(text.includes(value), `Missing customer-facing value: ${value}`);
  }
  assert.doesNotMatch(text, /private-item-id|invoice|DRAFT/);
  assert.deepEqual(quote, original);
  const fontNames = [...document.getPages()[0].node.Resources().lookup(PDFName.of('Font'), PDFDict).entries()]
    .map(([, ref]) => document.context.lookup(ref, PDFDict).lookup(PDFName.of('BaseFont')).toString()).join(' ');
  assert.match(fontNames, /Archivo/);
  assert.match(fontNames, /Inter/);
  assert.match(fontNames, /DMMono/);
  const interReference = [...document.getPages()[0].node.Resources().lookup(PDFName.of('Font'), PDFDict).entries()]
    .find(([, ref]) => document.context.lookup(ref, PDFDict).lookup(PDFName.of('BaseFont')).toString().includes('Inter'))[1];
  const inter = document.context.lookup(interReference, PDFDict);
  const descriptor = inter.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict).lookup(PDFName.of('FontDescriptor'), PDFDict);
  const embedded = fontkit.create(decodePDFRawStream(descriptor.lookup(PDFName.of('FontFile2'), PDFRawStream)).decode());
  const source = fontkit.create(await readFile(new URL('../../assets/quote-fonts/Inter.ttf', import.meta.url)));
  const unicode = Buffer.from(decodePDFRawStream(inter.lookup(PDFName.of('ToUnicode'), PDFRawStream)).decode()).toString();
  // Text extraction can pass while a damaged font subset leaves letters blank.
  // Verify that the actual PDF font retains the supplied visible letter outlines.
  for (const match of unicode.matchAll(/<([a-f\d]+)>\s*<([a-f\d]{4})>/gi)) {
    const codePoint = Number.parseInt(match[2], 16);
    if (codePoint < 65 || codePoint > 122) continue;
    assert.deepEqual(embedded.getGlyph(Number.parseInt(match[1], 16)).path.commands,
      source.glyphForCodePoint(codePoint).path.commands, `Embedded Inter outline for ${String.fromCodePoint(codePoint)}`);
  }
});

test('clearly labels drafts, renders supplied warnings, and prints markup as literal customer text', async () => {
  const quote = calculateQuote(input({
    customer: { name: '<b>Jordan & Green</b> 🌿\u0000', address: '24 Garden Street' },
    business: {}, scopeConfirmed: false, ratesConfirmed: false,
    items: [{ serviceId: 'turf', quantity: 2, description: '<script>alert("turf")</script> 🌿', confirmed: false }],
    scope: 'Install turf — agreed area. 中文',
  }));
  quote.model = 'private-model-detail';
  quote.recordings = [{ transcript: 'private-voice-capture' }];
  quote.photos = [{ dataUrl: 'private-photo-data' }];
  const document = await PDFDocument.load(await renderQuotePdf(quote));
  const pages = extractedPages(document);
  const text = pages.join('\n');
  assert.match(text, /DRAFT - REVIEW REQUIRED/);
  for (const warning of quote.warnings) assert.ok(text.includes(warning), warning);
  assert.ok(text.includes('<b>Jordan & Green</b> ?'));
  assert.ok(text.includes('<script>alert("turf")</script> ?'));
  assert.ok(text.includes('Install turf - agreed area. ??'));
  assert.doesNotMatch(text, /private-model-detail|private-voice-capture|private-photo-data/);
  assert.ok(pages.every(page => page.includes('DRAFT')));
});

test('paginates the full 60-item quote, long scope, split descriptions and exclusions with repeated headers', async () => {
  const quote = calculateQuote(input({
    scope: `${'Scope detail covering access, turf preparation and agreed work. '.repeat(120)}SCOPE END`,
    exclusions: `${'Excluded work remains outside the supplied scope. '.repeat(80)}EXCLUSIONS END`,
    items: Array.from({ length: 60 }, (_, index) => ({
      serviceId: 'turf', quantity: '1.25', confirmed: true,
      description: index === 29 ? `${'Detailed line\n'.repeat(54)}DESCRIPTION END 30` : `Item ${index + 1}: ${'Carefully prepare and install turf to the confirmed area. '.repeat(9)}LINEEND${index + 1}`,
    })),
  }));
  const document = await PDFDocument.load(await renderQuotePdf(quote));
  const pages = extractedPages(document);
  assert.ok(pages.length > 5);
  const text = pages.join('\n');
  assert.ok(text.includes('SCOPE END'));
  assert.ok(text.includes('DESCRIPTION END 30'));
  assert.ok(text.includes('EXCLUSIONS END'));
  assert.ok(text.includes(formatMoney(quote.totalCents)));
  for (let index = 1; index <= 60; index++) {
    if (index !== 30) assert.ok(text.includes(`LINEEND${index}\n`), `Missing item ${index}`);
  }
  assert.ok(pages.some(page => page.includes('Quote items / continued')));
  for (const [index, page] of pages.entries()) {
    assert.ok(page.includes(`${index + 1} / ${pages.length}`), `Missing page number on ${index + 1}`);
    if (page.includes('Quote items')) {
      for (const column of ['DESCRIPTION', 'QTY / UNIT', 'RATE', 'AMOUNT']) assert.ok(page.includes(column));
      assert.match(page, /Item \d|Detailed line|\(description continued\)/, 'A table header must stay with a quote item');
    }
  }
});

test('uses supplied normalized cents without recalculating or trusting raw input', async () => {
  await assert.rejects(renderQuotePdf(input()), /normalized quote/);
  const quote = calculateQuote(input());
  quote.items[0].rateCents = 789;
  quote.items[0].lineTotalCents = 12345;
  quote.subtotalCents = 12345;
  quote.taxCents = 1234;
  quote.totalCents = 13579;
  const text = extractedPages(await PDFDocument.load(await renderQuotePdf(quote))).join('\n');
  for (const cents of [789, 12345, 1234, 13579]) assert.ok(text.includes(formatMoney(cents)));
});
