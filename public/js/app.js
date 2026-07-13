/* Septona lobby signage — front-end renderer + auto-fit + auto-refresh */
(function () {
  'use strict';

  const qs = new URLSearchParams(location.search);
  if (qs.get('kiosk') === '1') document.body.setAttribute('data-kiosk', '1');

  const SHIFT_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
  const state = {
    data: null,
    activeSection: 0,
    layout: qs.get('layout') || 'board',
    lastParsedAt: null,
  };
  document.body.setAttribute('data-layout', state.layout);

  const el = (id) => document.getElementById(id);

  /* ---------- luminance helper: pick readable text over a bg color ---------- */
  function textOn(hex) {
    const c = hex.replace('#', '');
    const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#14181f' : '#ffffff';
  }
  // For dark board: worker name color is always light, but the num chip uses bus color bg.
  function chipStyle(hex) {
    return `background:${hex};color:${textOn(hex)};`;
  }

  /* ---------- current shift by local time ---------- */
  function currentShiftIndex() {
    const h = new Date().getHours();
    if (h >= 7 && h < 15) return 0;   // I смяна 07-15
    if (h >= 15 && h < 23) return 1;  // II смяна 15-23
    return 2;                          // III смяна 23-07
  }

  /* ---------- clock ---------- */
  const DAYS = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];
  const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
  function tickClock() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    el('clockTime').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    el('clockDate').textContent = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }

  /* ---------- rendering: header ---------- */
  function renderHeader() {
    const d = state.data;
    el('periodChip').textContent = d.period || '—';
    const sec = d.sections[state.activeSection];
    const csi = currentShiftIndex();
    const cs = sec.shifts[csi];
    el('currentShiftValue').textContent = cs.label;
    el('currentShiftCount').textContent = `${cs.count} работника`;

    // shift totals summed across ALL sections
    const totals = [0, 0, 0];
    let grand = 0;
    d.sections.forEach((s) => s.shifts.forEach((sh, i) => { totals[i] += sh.count; grand += sh.count; }));
    const st = el('shiftTotals');
    st.innerHTML = totals.map((n, i) =>
      `<div class="st"><span class="dot" style="background:${SHIFT_COLORS[i]}"></span>` +
      `<span class="n">${n}</span><span class="lbl">${['I', 'II', 'III'][i]} СМЯНА</span></div>`
    ).join('') + `<div class="st total"><span class="n">${grand}</span><span class="lbl">ОБЩО</span></div>`;
  }

  /* ---------- tabs ---------- */
  function renderTabs() {
    const d = state.data;
    el('tabs').innerHTML = d.sections.map((s, i) =>
      `<div class="tab ${i === state.activeSection ? 'active' : ''}" data-idx="${i}">` +
      `${s.name}<span class="badge">${s.total}</span></div>`
    ).join('');
    el('tabs').querySelectorAll('.tab').forEach((t) =>
      t.addEventListener('click', () => { state.activeSection = +t.dataset.idx; renderAll(); })
    );
  }

  /* ---------- board (dashboard) ---------- */
  function renderBoard() {
    const sec = state.data.sections[state.activeSection];
    const csi = currentShiftIndex();
    const maxWorkers = Math.max(...sec.shifts.map((s) => s.workers.length), 1);
    // rows per column: split into up to 2 sub-columns if very tall
    el('board').innerHTML = sec.shifts.map((sh, i) => {
      const isNow = i === csi;
      const cols = sh.workers.length > 28 ? 2 : 1;
      const rows = Math.ceil(sh.workers.length / cols) || 1;
      const workersHtml = sh.workers.map((w) => `
        <div class="worker">
          <span class="num" style="${chipStyle(w.color)}">${w.num != null ? w.num : ''}</span>
          <span class="meta">
            <span class="wname">${escapeHtml(w.name)}</span>
            <span class="wloc">${escapeHtml(w.location || '')}</span>
          </span>
        </div>`).join('');
      return `
        <section class="col">
          <div class="col-head ${isNow ? 'now' : ''}">
            <span class="cdot" style="background:${SHIFT_COLORS[i]}"></span>
            <span class="ctitle">${sh.label}</span>
            <span class="ctime">${sh.time}</span>
            ${isNow ? '<span class="live">СЕГА</span>' : ''}
            <span class="ccount"><span class="big">${sh.count}</span><span class="small">РАБОТНИКА</span></span>
          </div>
          <div class="col-body">
            <div class="workers" style="--rows:${rows}">${workersHtml || '<div class="wloc" style="padding:1vh">няма</div>'}</div>
          </div>
        </section>`;
    }).join('');
  }

  /* ---------- grid (faithful colored) ---------- */
  function renderGrid() {
    const sec = state.data.sections[state.activeSection];
    const gv = el('gridView');
    // Target: keep each sub-column to a readable number of rows.
    // The tallest shift determines a shared row count so all three columns align.
    const maxCount = Math.max(...sec.shifts.map((s) => s.workers.length), 1);
    // Choose rows-per-subcolumn so the tallest shift needs at most ROW_CAP rows.
    const ROW_CAP = 34;
    const rowsPerCol = Math.min(maxCount, ROW_CAP);
    const colsHtml = sec.shifts.map((sh) => {
      const subCols = Math.max(1, Math.ceil(sh.workers.length / rowsPerCol));
      const rowsHtml = sh.workers.map((w) => `
        <div class="grow" style="background:${w.color};color:${textOn(w.color)}">
          <span class="gnum">${w.num != null ? w.num : ''}</span>
          <span class="gname">${escapeHtml(w.name)}</span>
          <span class="gloc">${escapeHtml(w.location || '')}</span>
        </div>`).join('');
      return `
        <div class="gcol" style="--f:${subCols}">
          <div class="gcol-head">${sh.label} · ${sh.time} · ${sh.count}</div>
          <div class="grows" style="--grows:${rowsPerCol};--subcols:${subCols}">${rowsHtml}</div>
        </div>`;
    }).join('');
    gv.innerHTML = `<div class="gsec-title">${sec.name} — ${state.data.period || ''}</div><div class="gcols">${colsHtml}</div>`;
  }

  /* ---------- legend ---------- */
  function renderLegend() {
    const lines = state.data.lines || [];
    el('legend').innerHTML = lines.map((l) =>
      `<span class="li"><span class="sw" style="background:${l.color}"></span>${escapeHtml(l.name)}</span>`
    ).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* ---------- auto-fit: scale font so the active view never scrolls ---------- */
  function autoFit() {
    // Adjust a global font scale by measuring overflow of the visible main region.
    const view = state.layout === 'board' ? el('board') : el('gridView');
    if (!view) return;
    let scale = 1.0;
    document.documentElement.style.setProperty('--fit', scale);
    // Binary-ish shrink: reduce until no overflow (cap iterations)
    const maxH = view.clientHeight;
    for (let i = 0; i < 8; i++) {
      const overflow = view.scrollHeight - maxH;
      if (overflow <= 2) break;
      scale *= 0.94;
      applyScale(scale);
    }
  }
  function applyScale(scale) {
    // Scale worker text via a CSS var multiplier on relevant elements
    const root = document.documentElement;
    root.style.setProperty('--wscale', scale);
    document.querySelectorAll('.workers, .grows').forEach((n) => {
      n.style.fontSize = (scale) + 'em';
    });
  }

  function renderAll() {
    if (!state.data) return;
    document.body.setAttribute('data-layout', state.layout);
    el('board').hidden = state.layout !== 'board';
    el('gridView').hidden = state.layout !== 'grid';
    renderHeader();
    renderTabs();
    renderLegend();
    if (state.layout === 'board') renderBoard(); else renderGrid();
    requestAnimationFrame(() => requestAnimationFrame(autoFit));
  }

  /* ---------- data load + refresh ---------- */
  async function loadData(force) {
    try {
      const r = await fetch('/api/schedule', { cache: 'no-store' });
      if (r.status === 404) { el('emptyState').hidden = false; return; }
      el('emptyState').hidden = true;
      const d = await r.json();
      if (force || d.parsedAt !== state.lastParsedAt) {
        state.data = d; state.lastParsedAt = d.parsedAt;
        if (state.activeSection >= d.sections.length) state.activeSection = 0;
        renderAll();
      }
    } catch (e) { console.error('load error', e); }
  }

  /* ---------- controls ---------- */
  el('controls').querySelectorAll('button[data-layout]').forEach((b) =>
    b.addEventListener('click', () => {
      state.layout = b.dataset.layout;
      el('controls').querySelectorAll('.ctrl').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      renderAll();
    })
  );

  /* ---------- auto-rotate sections (signage) ---------- */
  const rotate = qs.get('rotate');
  if (rotate) {
    const secs = parseInt(rotate, 10) || 15;
    setInterval(() => {
      if (!state.data) return;
      state.activeSection = (state.activeSection + 1) % state.data.sections.length;
      renderAll();
    }, secs * 1000);
  }

  /* ---------- boot ---------- */
  tickClock();
  setInterval(tickClock, 1000);
  setInterval(renderHeader, 30 * 1000); // refresh current-shift highlight
  loadData(true);
  setInterval(loadData, 20 * 1000);     // poll for new uploads
  window.addEventListener('resize', () => renderAll());
})();
