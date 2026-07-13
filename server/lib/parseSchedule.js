'use strict';
/**
 * Robust parser for the Septona weekly schedule (.xlsx).
 *
 * BUS-LINE COLOURING (the critical requirement)
 * ---------------------------------------------
 * Every worker rides a bus LINE, shown in the sheet as a row background colour.
 * The sheet also contains a legend that maps each pickup LOCATION -> bus line
 * (grouped in column B as "линия …") and colours the location cell with that
 * line's colour. We parse the legend to build:  location -> {line, colour}.
 * Each worker is then coloured by matching their location to that legend, with
 * the worker row's own cell fill used as a cross-check / fallback. This keeps
 * colours correct even if a future export shifts cells around.
 *
 * LAYOUT
 * ------
 * The sheet is two independent vertical halves that share rows:
 *   LEFT  half  (cols A..G): num=A, [name=B loc=C] [name=D loc=E] [name=F loc=G]
 *   RIGHT half  (cols H..N): num=H, [name=I loc=J] [name=K loc=L] [name=M loc=N]
 * Within each half there are stacked "blocks", each introduced by a shift-header
 * row ("1-ва смяна …" / "FIRST SHIFT") and optionally a cex title row
 * ("цех \"НЕТЪКАН ТЕКСТИЛ\""). We detect blocks structurally so the parser adapts
 * to any week's file.
 */

const ExcelJS = require('exceljs');

// Office 2007-2010 theme palette (from the source workbook theme1.xml).
const THEME_COLORS = {
  0: 'FFFFFF', 1: '000000', 2: 'EEECE1', 3: '1F497D',
  4: '4F81BD', 5: 'C0504D', 6: '9BBB59', 7: '8064A2',
  8: '4BACC6', 9: 'F79646',
};

function applyTint(hex, tint) {
  let r = parseInt(hex.slice(0, 2), 16) / 255;
  let g = parseInt(hex.slice(2, 4), 16) / 255;
  let b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  if (tint < 0) l = l * (1 + tint); else l = l * (1 - tint) + tint;
  l = Math.min(Math.max(l, 0), 1);
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let ro, go, bo;
  if (s === 0) ro = go = bo = l;
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    ro = hue2rgb(p, q, h + 1 / 3); go = hue2rgb(p, q, h); bo = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0').toUpperCase();
  return '#' + toHex(ro) + toHex(go) + toHex(bo);
}

function resolveFillHex(cell) {
  const fill = cell && cell.fill;
  if (!fill || fill.type !== 'pattern' || fill.pattern !== 'solid') return null;
  const fg = fill.fgColor;
  if (!fg) return null;
  if (fg.argb) {
    const hex = fg.argb.length === 8 ? fg.argb.slice(2) : fg.argb;
    return '#' + hex.toUpperCase();
  }
  if (typeof fg.theme === 'number') {
    const base = THEME_COLORS[fg.theme];
    if (base == null) return null;
    return applyTint(base, typeof fg.tint === 'number' ? fg.tint : 0);
  }
  return null;
}

const cellText = (cell) => {
  const v = cell && cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.formula != null) return '';
  }
  return String(v).trim();
};

const normLoc = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase()
  .replace(/^С\.\s*/, 'С. ').replace(/^ГР\.\s*/, 'ГР. ')
  // Latin "RUSE" is the same city as Cyrillic "РУСЕ" (foreign-worker rows use Latin)
  .replace(/^RUSE$/i, 'РУСЕ');

const isShiftHeader = (v) => /1-ва смяна|2-ра смяна|3-та смяна|FIRST SHIFT|SECOND SHIFT|THIRD SHIFT/i.test(v);
const isNoise = (v) => isShiftHeader(v) || /цех|ХИГИЕНИСТКА|СМЯНА|^линия/i.test(v);

/** Parse legend: build Map(normLoc -> {line,color}) and ordered line list. */
function parseLegend(ws) {
  const locToLine = new Map();
  const linesMap = new Map();
  let currentLine = null;
  const maxR = ws.rowCount;
  for (let r = 1; r <= maxR; r++) {
    const bStr = cellText(ws.getCell(r, 2));
    const cCell = ws.getCell(r, 3);
    const cStr = cellText(cCell);
    // A legend row is one whose column D (or E/F) holds a COUNTIF formula.
    const dCell = ws.getCell(r, 4);
    const dIsCount = dCell && dCell.value && typeof dCell.value === 'object'
      && dCell.value.formula && /COUNTIF/i.test(dCell.value.formula);
    if (/^линия(\s|$)/i.test(bStr) || /^РУСЕ$/i.test(bStr)) currentLine = bStr;
    if (!dIsCount || !cStr || !currentLine) continue;
    const hex = resolveFillHex(cCell) || '#FFFFFF';
    const key = normLoc(cStr);
    if (!locToLine.has(key)) locToLine.set(key, { line: currentLine, color: hex });
    if (!linesMap.has(currentLine)) linesMap.set(currentLine, { name: currentLine, color: hex, locations: [] });
    if (!linesMap.get(currentLine).locations.includes(cStr)) linesMap.get(currentLine).locations.push(cStr);
  }
  return { locToLine, lines: Array.from(linesMap.values()) };
}

function colorForWorker(location, fillHex, locToLine) {
  const key = normLoc(location);
  if (locToLine.has(key)) return locToLine.get(key);
  if (fillHex) {
    for (const v of locToLine.values())
      if (v.color.toUpperCase() === fillHex.toUpperCase()) return { line: v.line, color: v.color };
    return { line: null, color: fillHex };
  }
  return { line: 'РУСЕ', color: '#FFFFFF' };
}

/** Read one shift column (name+loc) across a row range into worker objects. */
function readShift(ws, r0, r1, numCol, nameCol, locCol, locToLine) {
  const out = [];
  for (let r = r0; r <= r1; r++) {
    const name = cellText(ws.getCell(r, nameCol));
    if (!name || isNoise(name)) continue;
    const location = cellText(ws.getCell(r, locCol));
    const numV = ws.getCell(r, numCol).value;
    const fillHex = resolveFillHex(ws.getCell(r, nameCol)) || resolveFillHex(ws.getCell(r, locCol));
    const c = colorForWorker(location, fillHex, locToLine);
    out.push({
      num: numV == null ? null : (typeof numV === 'number' ? numV : cellText(ws.getCell(r, numCol))),
      name, location, color: c.color, line: c.line,
    });
  }
  return out;
}

/**
 * Detect blocks in a half. A "half" is defined by its column set.
 * Returns array of blocks: {title, startRow, endRow}. Blocks are delimited by
 * shift-header rows; a cex-title row before a header starts a titled block.
 */
function detectBlocks(ws, cols, dataStart, dataEnd) {
  const { num, name1 } = cols;
  const blocks = [];
  let curTitle = null;
  let blockStart = null;
  let pendingTitle = null;

  for (let r = dataStart; r <= dataEnd; r++) {
    // cex title spans the half (search name1..last col for "цех")
    let cexTitle = null;
    for (const c of [num, name1, name1 + 2, name1 + 4]) {
      const t = cellText(ws.getCell(r, c));
      if (/цех/i.test(t)) { cexTitle = t.replace(/цех\s*/i, '').replace(/["“”]/g, '').trim(); break; }
    }
    const headerText = cellText(ws.getCell(r, name1));
    const isHeader = isShiftHeader(headerText) ||
      isShiftHeader(cellText(ws.getCell(r, num))); // left half puts header in B

    if (cexTitle) { pendingTitle = cexTitle; continue; }

    if (isHeader) {
      // close previous block
      if (blockStart != null) blocks.push({ title: curTitle, startRow: blockStart, endRow: r - 1 });
      curTitle = pendingTitle || curTitle;
      pendingTitle = null;
      blockStart = r + 1;
    }
  }
  if (blockStart != null) blocks.push({ title: curTitle, startRow: blockStart, endRow: dataEnd });
  return blocks.filter((b) => b.endRow >= b.startRow);
}

async function parseScheduleBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];

  // Title / period
  let title = '', period = '';
  ws.eachRow((row) => row.eachCell({ includeEmpty: false }, (cell) => {
    const v = cellText(cell);
    if (/СЕПТОНА/i.test(v) && !title) title = v.replace(/\s*\n\s*/g, '  ').trim();
    if (/ЗА РАБОТА ЗА ПЕРИОДА/i.test(v) && !period)
      period = v.replace(/^[\s\S]*ПЕРИОДА:\s*/i, '').replace(/\s*\n\s*/g, ' ').trim();
  }));

  const { locToLine, lines } = parseLegend(ws);

  // ---- Assign a stable BUS-LINE NUMBER to each line ----
  // The number shown in each worker's bubble is their BUS LINE (not their
  // ordinal position), so everyone on the same line shares one number+color.
  // Preferred order: РУСЕ = 1 (city bus, white), обретеник = 2 (green), then
  // the remaining lines in legend order.
  const linePriority = (name) => {
    const n = String(name || '').toLowerCase();
    if (/русе|ruse/.test(n)) return 0;        // 1 — city bus (white)
    if (/обретеник/.test(n)) return 1;         // 2 — green
    return 2;                                   // others keep legend order
  };
  const orderedLines = lines
    .map((l, i) => ({ ...l, _legend: i }))
    .sort((a, b) => (linePriority(a.name) - linePriority(b.name)) || (a._legend - b._legend));
  const lineNoByName = new Map();
  orderedLines.forEach((l, i) => { l.lineNo = i + 1; delete l._legend; lineNoByName.set(l.name, i + 1); });

  // Legend starts where column B says "линия" or column D has COUNTIF.
  let legendStart = ws.rowCount + 1;
  for (let r = 1; r <= ws.rowCount; r++) {
    const b = cellText(ws.getCell(r, 2));
    const d = ws.getCell(r, 4).value;
    if (/^линия(\s|$)/i.test(b) || (d && typeof d === 'object' && d.formula && /COUNTIF/i.test(d.formula))) {
      legendStart = r; break;
    }
  }
  const dataEnd = legendStart - 1;
  const DATA_START = 5; // start above the first shift-header (row 6) so block detection opens it

  const LEFT = { num: 1, name1: 2 };   // A / B,D,F  loc C,E,G
  const RIGHT = { num: 8, name1: 9 };  // H / I,K,M  loc J,L,N

  function buildHalf(cols, halfName) {
    const blocks = detectBlocks(ws, cols, DATA_START, dataEnd);
    return blocks.map((blk) => {
      const shifts = [
        { index: 1, label: 'I СМЯНА', time: '07:00 – 15:00' },
        { index: 2, label: 'II СМЯНА', time: '15:00 – 23:00' },
        { index: 3, label: 'III СМЯНА', time: '23:00 – 07:00' },
      ].map((s, i) => {
        const nameCol = cols.name1 + i * 2;
        const locCol = nameCol + 1;
        const workers = readShift(ws, blk.startRow, blk.endRow, cols.num, nameCol, locCol, locToLine);
        return { ...s, workers, count: workers.length };
      });
      return { title: blk.title, half: halfName, shifts };
    });
  }

  const leftBlocks = buildHalf(LEFT, 'left');
  const rightBlocks = buildHalf(RIGHT, 'right');

  // Assemble logical sections. Main production halves (untitled blocks) merge
  // into one "ТЪКАЧЕН ЦЕХ" section (left=women, right=men). Titled blocks
  // (НЕТЪКАН ТЕКСТИЛ, ХАРТИЯ И ПЛАСТМАСА) become their own sections.
  const sections = [];

  function mergeShifts(blocks) {
    const merged = [
      { index: 1, label: 'I СМЯНА', time: '07:00 – 15:00', workers: [] },
      { index: 2, label: 'II СМЯНА', time: '15:00 – 23:00', workers: [] },
      { index: 3, label: 'III СМЯНА', time: '23:00 – 07:00', workers: [] },
    ];
    for (const b of blocks) b.shifts.forEach((s, i) => { merged[i].workers.push(...s.workers); });
    merged.forEach((s) => { s.count = s.workers.length; });
    return merged;
  }

  const mainBlocks = [...leftBlocks, ...rightBlocks].filter((b) => !b.title);
  if (mainBlocks.length) {
    const shifts = mergeShifts(mainBlocks);
    sections.push({ id: 'main', name: 'ПРОИЗВОДСТВО', shifts, total: shifts.reduce((a, s) => a + s.count, 0) });
  }

  const titled = [...leftBlocks, ...rightBlocks].filter((b) => b.title);
  const byTitle = new Map();
  for (const b of titled) {
    if (!byTitle.has(b.title)) byTitle.set(b.title, []);
    byTitle.get(b.title).push(b);
  }
  let idx = 0;
  for (const [tname, blks] of byTitle) {
    const shifts = mergeShifts(blks);
    sections.push({ id: 'sec' + (idx++), name: tname, shifts, total: shifts.reduce((a, s) => a + s.count, 0) });
  }

  const grandTotal = sections.reduce((a, s) => a + s.total, 0);

  // Stamp each worker with their bus-line number (falls back to null if the
  // line couldn't be resolved, e.g. an unknown location).
  sections.forEach((sec) => sec.shifts.forEach((sh) => sh.workers.forEach((w) => {
    w.lineNo = w.line != null && lineNoByName.has(w.line) ? lineNoByName.get(w.line) : null;
  })));

  return {
    title: title || '„СЕПТОНА БЪЛГАРИЯ" АД',
    period, grandTotal, parsedAt: new Date().toISOString(),
    lines: orderedLines, sections,
  };
}

module.exports = { parseScheduleBuffer, resolveFillHex, applyTint, cellText };
