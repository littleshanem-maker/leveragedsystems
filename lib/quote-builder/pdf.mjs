import { readFile } from 'node:fs/promises';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { formatMoney } from '../../tools/quote-builder/domain.mjs';

const PAGE = { width: 595.28, height: 841.89, margin: 42, bottom: 68 };
const WIDTH = PAGE.width - PAGE.margin * 2;
const COLOUR = {
  ink: rgb(10 / 255, 10 / 255, 10 / 255),
  grey: rgb(107 / 255, 107 / 255, 107 / 255),
  light: rgb(247 / 255, 247 / 255, 247 / 255),
  line: rgb(229 / 255, 229 / 255, 229 / 255),
  orange: rgb(1, 91 / 255, 20 / 255),
  white: rgb(1, 1, 1),
};
let fontFiles;

function loadFontFiles() {
  fontFiles ??= Promise.all([
    readFile(new URL('../../assets/quote-fonts/Archivo.ttf', import.meta.url)),
    readFile(new URL('../../assets/quote-fonts/Inter.ttf', import.meta.url)),
    readFile(new URL('../../assets/quote-fonts/DMMono.ttf', import.meta.url)),
  ]).catch(error => { fontFiles = undefined; throw error; });
  return fontFiles;
}

function requireCalculatedQuote(quote) {
  const cents = value => Number.isSafeInteger(value) && value >= 0;
  if (!quote || !Array.isArray(quote.items) || !quote.items.length || quote.items.length > 60 ||
    !quote.items.every(item => item && typeof item.description === 'string' && typeof item.unit === 'string' &&
      Number.isFinite(item.quantity) && item.quantity > 0 && cents(item.rateCents) && cents(item.lineTotalCents)) ||
    !['subtotalCents', 'taxCents', 'totalCents'].every(key => cents(quote[key])) ||
    ![0, 1000].includes(quote.taxRateBps) || typeof quote.isDraft !== 'boolean' ||
    !Array.isArray(quote.warnings) || !quote.warnings.every(warning => typeof warning === 'string') ||
    !quote.customer || !quote.business ||
    !['reference', 'issueDate', 'validUntil', 'scope', 'exclusions'].every(key => typeof quote[key] === 'string')) {
    throw new TypeError('PDF export requires a normalized quote from calculateQuote.');
  }
}

function textTools(fonts) {
  const supported = new Map(Object.values(fonts).map(font => [font, new Set(font.getCharacterSet())]));
  const clean = (value, font) => [...String(value ?? '').normalize('NFC')
    .replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n')
    .replace(/\t/g, ' ').replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufe0e\ufe0f]/g, '')]
    .map(character => character === '\n' || supported.get(font).has(character.codePointAt(0)) ? character : '?').join('');

  function wrap(value, font, size, width) {
    const lines = [];
    for (const paragraph of clean(value, font).split('\n')) {
      let line = '';
      for (const word of paragraph.trim().split(/\s+/u).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
        if (line) { lines.push(line); line = ''; }
        for (const character of word) {
          if (line && font.widthOfTextAtSize(line + character, size) > width) {
            lines.push(line); line = '';
          }
          line += character;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  function shorten(value, font, size, width) {
    const single = clean(value, font).replace(/\s+/g, ' ');
    if (font.widthOfTextAtSize(single, size) <= width) return single;
    let result = '';
    for (const character of single) {
      if (font.widthOfTextAtSize(`${result}${character}...`, size) > width) break;
      result += character;
    }
    return `${result}...`;
  }
  return { clean, wrap, shorten };
}

/** Render only a calculated quote. Amounts are printed as supplied, without pricing logic. */
export async function renderQuotePdf(quote) {
  requireCalculatedQuote(quote);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const bytes = await loadFontFiles();
  const [heading, body, mono] = await Promise.all(bytes.map(file => document.embedFont(file, { subset: true })));
  const { clean, wrap, shorten } = textTools({ heading, body, mono });
  const reference = clean(quote.reference, mono);
  document.setTitle(`Quote ${reference}`);
  document.setAuthor(clean(quote.business.name, body));
  document.setSubject('Landscaping quote');
  document.setCreator('Leveraged Systems');
  document.setProducer('Leveraged Systems');
  let page;
  let y;

  function draw(value, x, baseline, { font = body, size = 10, colour = COLOUR.ink, width, align = 'left' } = {}) {
    const valueText = clean(value, font).replace(/\n/g, ' ');
    const actualX = align === 'right' ? x + width - font.widthOfTextAtSize(valueText, size) : x;
    page.drawText(valueText, { x: actualX, y: baseline, size, font, color: colour });
  }
  function rule(baseline, colour = COLOUR.line) {
    page.drawLine({ start: { x: PAGE.margin, y: baseline }, end: { x: PAGE.width - PAGE.margin, y: baseline }, thickness: 0.7, color: colour });
  }
  function newPage() {
    page = document.addPage([PAGE.width, PAGE.height]);
    page.drawRectangle({ x: PAGE.margin, y: PAGE.height - 47, width: 22, height: 4, color: COLOUR.orange });
    if (document.getPageCount() === 1) {
      draw('LANDSCAPING / CUSTOMER QUOTE', PAGE.margin, PAGE.height - 65, { font: mono, size: 8, colour: COLOUR.grey });
      draw('Quote', PAGE.margin, PAGE.height - 108, { font: heading, size: 35 });
      if (quote.isDraft) draw('DRAFT', PAGE.margin + WIDTH - 97, PAGE.height - 104, { font: heading, size: 23, colour: COLOUR.orange });
      y = PAGE.height - 132;
    } else {
      draw(shorten(`QUOTE / ${reference}`, mono, 8.5, WIDTH - 100), PAGE.margin, PAGE.height - 65, { font: mono, size: 8.5 });
      if (quote.isDraft) draw('DRAFT', PAGE.margin + WIDTH - 55, PAGE.height - 65, { font: heading, size: 13, colour: COLOUR.orange });
      draw(shorten(quote.business.name || 'Landscaping quote', body, 8, WIDTH), PAGE.margin, PAGE.height - 81, { size: 8, colour: COLOUR.grey });
      rule(PAGE.height - 94);
      y = PAGE.height - 113;
    }
  }
  function ensure(height) { if (y - height < PAGE.bottom) newPage(); }
  function sectionTitle(title, continuation = false) {
    ensure(36);
    draw(`${title}${continuation ? ' / continued' : ''}`, PAGE.margin, y - 13, { font: heading, size: 14 });
    y -= 27;
  }
  function paragraphSection(title, value) {
    const lines = wrap(value, body, 10, WIDTH);
    ensure(54);
    sectionTitle(title);
    for (const line of lines) {
      if (y - 14 < PAGE.bottom) { newPage(); sectionTitle(title, true); }
      draw(line, PAGE.margin, y - 10, { size: 10 });
      y -= 14;
    }
    y -= 17;
  }

  newPage();
  const metadata = [
    { label: 'REFERENCE', value: quote.reference, width: WIDTH * 0.48 },
    { label: 'ISSUED', value: quote.issueDate, width: WIDTH * 0.26 },
    { label: 'VALID UNTIL', value: quote.validUntil, width: WIDTH * 0.26 },
  ];
  let metadataX = PAGE.margin;
  let metadataHeight = 0;
  for (const field of metadata) {
    draw(field.label, metadataX, y - 8, { font: mono, size: 7.5, colour: COLOUR.grey });
    const lines = wrap(field.value, mono, 9, field.width - 15);
    lines.forEach((line, index) => draw(line, metadataX, y - 26 - index * 12, { font: mono, size: 9 }));
    metadataHeight = Math.max(metadataHeight, 30 + lines.length * 12);
    metadataX += field.width;
  }
  y -= metadataHeight + 10;

  if (quote.isDraft) {
    ensure(46);
    sectionTitle('DRAFT - REVIEW REQUIRED');
    const warnings = quote.warnings.length ? quote.warnings : ['This quote is a draft. Review before sharing as a final quote.'];
    for (const warning of warnings) {
      for (const line of wrap(warning, body, 9, WIDTH - 20)) {
        if (y - 18 < PAGE.bottom) { newPage(); sectionTitle('DRAFT - REVIEW REQUIRED', true); }
        page.drawRectangle({ x: PAGE.margin, y: y - 17, width: 3, height: 17, color: COLOUR.orange });
        draw(line, PAGE.margin + 12, y - 11, { size: 9, colour: COLOUR.grey });
        y -= 17;
      }
    }
    y -= 19;
  }

  const gap = 22;
  const partyWidth = (WIDTH - gap) / 2;
  function partyLines(party, customer = false) {
    const blocks = [];
    const add = (value, font, size, lineHeight, colour) => {
      if (value) blocks.push(...wrap(value, font, size, partyWidth - 24).map(text => ({ text, font, size, lineHeight, colour })));
    };
    add(party.name || 'Name not supplied', heading, 14, 18, COLOUR.ink);
    if (customer) add(party.address || 'Property address not supplied', body, 9, 13, COLOUR.ink);
    add(party.email, body, 9, 13, COLOUR.grey);
    add(party.phone, mono, 8, 12, COLOUR.grey);
    if (!customer && party.abn) add(`ABN ${party.abn}`, mono, 8, 12, COLOUR.grey);
    return blocks;
  }
  const parties = [
    { title: 'PREPARED BY', lines: partyLines(quote.business) },
    { title: 'PREPARED FOR / PROPERTY', lines: partyLines(quote.customer, true) },
  ];
  const partyHeight = Math.max(...parties.map(party => party.lines.reduce((height, line) => height + line.lineHeight, 0))) + 45;
  ensure(partyHeight);
  parties.forEach((party, column) => {
    const x = PAGE.margin + column * (partyWidth + gap);
    page.drawRectangle({ x, y: y - partyHeight, width: partyWidth, height: partyHeight, color: COLOUR.light });
    draw(party.title, x + 12, y - 19, { font: mono, size: 7, colour: COLOUR.grey });
    let baseline = y - 40;
    for (const line of party.lines) {
      draw(line.text, x + 12, baseline, line);
      baseline -= line.lineHeight;
    }
  });
  y -= partyHeight + 24;
  paragraphSection('Scope of work', quote.scope || 'Scope not supplied.');

  const columns = [
    { label: 'DESCRIPTION', width: WIDTH - 293, align: 'left' },
    { label: 'QTY / UNIT', width: 80, align: 'left' },
    { label: 'RATE', width: 96, align: 'right' },
    { label: 'AMOUNT', width: 117, align: 'right' },
  ];
  const lineHeight = 13;
  const freshTableSpace = PAGE.height - 113 - 52 - PAGE.bottom;
  const quantityFormatter = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 });
  const itemFields = item => [
    wrap(item.description, body, 9.5, columns[0].width - 18),
    wrap(`${quantityFormatter.format(item.quantity)}\n${item.unit}`, mono, 8.5, columns[1].width - 18),
    [formatMoney(item.rateCents)],
    [formatMoney(item.lineTotalCents)],
  ];
  function tableHeader(continued = false) {
    ensure(75);
    sectionTitle('Quote items', continued);
    page.drawRectangle({ x: PAGE.margin, y: y - 25, width: WIDTH, height: 25, color: COLOUR.ink });
    let x = PAGE.margin;
    for (const column of columns) {
      draw(column.label, x + 9, y - 16, { font: mono, size: 7, colour: COLOUR.white, width: column.width - 18, align: column.align });
      x += column.width;
    }
    y -= 25;
  }
  const firstRowHeight = Math.max(...itemFields(quote.items[0]).map(lines => lines.length)) * lineHeight + 18;
  ensure(52 + Math.min(firstRowHeight, freshTableSpace));
  tableHeader();
  for (const [itemIndex, item] of quote.items.entries()) {
    const fields = itemFields(item);
    const rowLines = Math.max(...fields.map(lines => lines.length));
    const fullRowHeight = rowLines * lineHeight + 18;
    if (fullRowHeight <= freshTableSpace && y - fullRowHeight < PAGE.bottom) {
      newPage();
      tableHeader(true);
    }
    let offset = 0;
    while (offset < rowLines) {
      const continued = offset > 0;
      const padding = 9;
      const continuationHeight = continued ? 13 : 0;
      let lineCapacity = Math.floor((y - PAGE.bottom - padding * 2 - continuationHeight) / lineHeight);
      if (lineCapacity < 1) { newPage(); tableHeader(true); continue; }
      const take = Math.min(rowLines - offset, lineCapacity);
      const height = take * lineHeight + padding * 2 + continuationHeight;
      if (itemIndex % 2 === 0) page.drawRectangle({ x: PAGE.margin, y: y - height, width: WIDTH, height, color: COLOUR.light });
      if (continued) draw('(description continued)', PAGE.margin + 9, y - 13, { size: 7.5, colour: COLOUR.grey });
      let x = PAGE.margin;
      for (const [columnIndex, column] of columns.entries()) {
        fields[columnIndex].slice(offset, offset + take).forEach((line, index) => {
          const font = columnIndex === 0 ? body : mono;
          let size = columnIndex === 0 ? 9.5 : 8.5;
          if (columnIndex > 1) size = Math.min(size, size * (column.width - 18) / font.widthOfTextAtSize(line, size));
          draw(line, x + 9, y - padding - 9.5 - continuationHeight - index * lineHeight, { font, size, width: column.width - 18, align: column.align });
        });
        x += column.width;
      }
      y -= height;
      rule(y);
      offset += take;
      if (offset < rowLines) { newPage(); tableHeader(true); }
    }
  }
  y -= 18;

  ensure(117);
  const totalWidth = 292;
  const totalX = PAGE.margin + WIDTH - totalWidth;
  draw('All amounts in AUD', PAGE.margin, y - 11, { size: 8, colour: COLOUR.grey });
  for (const [index, [label, value]] of [
    ['Subtotal', quote.subtotalCents],
    [quote.taxRateBps === 1000 ? 'GST (10%)' : 'GST (0%)', quote.taxCents],
  ].entries()) {
    draw(label, totalX + 12, y - 11 - index * 25, { size: 10 });
    draw(formatMoney(value), totalX + 105, y - 11 - index * 25, { font: mono, size: 10, width: totalWidth - 117, align: 'right' });
  }
  page.drawRectangle({ x: totalX, y: y - 94, width: totalWidth, height: 40, color: COLOUR.orange });
  draw('TOTAL AUD', totalX + 12, y - 79, { font: mono, size: 10 });
  const totalText = formatMoney(quote.totalCents);
  const totalFontSize = Math.min(16, 16 * (totalWidth - 120) / mono.widthOfTextAtSize(totalText, 16));
  draw(totalText, totalX + 110, y - 80, { font: mono, size: totalFontSize, width: totalWidth - 122, align: 'right' });
  y -= 118;
  if (quote.exclusions) paragraphSection('Exclusions', quote.exclusions);

  const pages = document.getPages();
  pages.forEach((footerPage, index) => {
    page = footerPage;
    rule(49);
    draw(quote.isDraft ? 'DRAFT - Review required / All amounts AUD' : 'Quote / All amounts AUD', PAGE.margin, 33, { font: mono, size: 7, colour: quote.isDraft ? COLOUR.orange : COLOUR.grey });
    draw(`${index + 1} / ${pages.length}`, PAGE.width - PAGE.margin - 60, 33, { font: mono, size: 7.5, colour: COLOUR.grey, width: 60, align: 'right' });
  });
  return document.save();
}
