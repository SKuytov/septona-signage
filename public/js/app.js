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
    el('board').innerHTML = sec.shifts.map((sh, i) => {
      const isNow = i === csi;
      // Always use up to 2 sub-columns; rows flow naturally and may overflow
      // the viewport (the list auto-scrolls to reveal everyone).
      const cols = sh.workers.length > 16 ? 2 : 1;
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

  /* ---------- auto-fit: shrink the GRID view so it never scrolls ----------
     (The board view no longer shrinks — instead each column auto-scrolls
      vertically to reveal long worker lists.) */
  function autoFit() {
    if (state.layout !== 'grid') return;
    const view = el('gridView');
    if (!view) return;
    let scale = 1.0;
    const maxH = view.clientHeight;
    for (let i = 0; i < 8; i++) {
      const overflow = view.scrollHeight - maxH;
      if (overflow <= 2) break;
      scale *= 0.94;
      view.querySelectorAll('.grows').forEach((n) => { n.style.fontSize = scale + 'em'; });
    }
  }

  /* ---------- board column auto-scroll engine ----------
     Each shift column's worker list gently scrolls up when it's taller than
     its viewport, pauses at the top and bottom, then loops back to the top.
     Runs on requestAnimationFrame; restarted on every board re-render. */
  let scrollRAF = null;
  const SCROLL_SPEED = 14;   // px per second
  const PAUSE_MS = 3500;     // pause at top and bottom
  function startColumnScroll() {
    if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }
    if (state.layout !== 'board') return;
    const tracks = Array.from(document.querySelectorAll('#board .col-body')).map((body) => {
      const track = body.querySelector('.workers');
      const max = Math.max(0, track.scrollHeight - body.clientHeight);
      track.style.transform = 'translateY(0)';
      return { track, max, y: 0, dir: 1, pausedUntil: performance.now() + PAUSE_MS };
    }).filter((t) => t.max > 4); // only scroll columns that actually overflow
    if (!tracks.length) return;
    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const t of tracks) {
        if (now < t.pausedUntil) continue;
        t.y += t.dir * SCROLL_SPEED * dt;
        if (t.y >= t.max) { t.y = t.max; t.dir = -1; t.pausedUntil = now + PAUSE_MS; }
        else if (t.y <= 0) { t.y = 0; t.dir = 1; t.pausedUntil = now + PAUSE_MS; }
        t.track.style.transform = `translateY(${-t.y}px)`;
      }
      scrollRAF = requestAnimationFrame(frame);
    }
    scrollRAF = requestAnimationFrame(frame);
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
    requestAnimationFrame(() => requestAnimationFrame(() => {
      autoFit();
      startColumnScroll();
    }));
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

  /* ======================================================================
     MESSAGES ENGINE
     - ticker:   scrolling strip along the bottom (always visible if any)
     - slide:    full-screen cards rotated between the schedule
     - takeover: urgent full-screen, interrupts everything
     ====================================================================== */
  const msgState = {
    all: [], ticker: [], slides: [], takeovers: [],
    slideIdx: 0, slideTimer: null, takeoverActive: false, updatedAt: null,
  };
  const BADGE = { info: 'ИНФОРМАЦИЯ', warning: 'ВНИМАНИЕ', urgent: '⚠ ВАЖНО' };

  function escapeHtmlMsg(s) { return escapeHtml(s == null ? '' : s); }

  async function loadMessages() {
    try {
      const r = await fetch('/api/messages', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      const changed = d.updatedAt !== msgState.updatedAt ||
        (d.messages || []).length !== msgState.all.length;
      msgState.updatedAt = d.updatedAt;
      msgState.all = d.messages || [];
      msgState.ticker = msgState.all.filter((m) => m.mode === 'banner');
      msgState.slides = msgState.all.filter((m) => m.mode === 'slide');
      msgState.takeovers = msgState.all.filter((m) => m.mode === 'takeover');
      if (changed) { renderTicker(); resetSlides(); }
      handleTakeover();
    } catch (e) { console.error('msg load', e); }
  }

  /* ---------- ticker ---------- */
  function renderTicker() {
    const wrap = el('msgTicker');
    if (!msgState.ticker.length) { wrap.hidden = true; document.body.removeAttribute('data-ticker'); return; }
    wrap.hidden = false;
    document.body.setAttribute('data-ticker', '1');
    const top = msgState.ticker[0];
    wrap.style.setProperty('--tag', top.color);
    el('tickerTag').textContent = top.priority === 'urgent' ? 'ВАЖНО' : 'СЪОБЩЕНИЕ';
    const items = msgState.ticker.map((m) => {
      const txt = [m.title, m.body].filter(Boolean).join(' — ');
      return `<span class="tk-item"><span class="tk-dot" style="background:${m.color}"></span>${escapeHtmlMsg(txt)}</span>`;
    }).join('');
    const track = el('tickerTrack');
    track.innerHTML = items + items; // duplicate for seamless loop
    // speed proportional to content length
    const len = track.textContent.length;
    track.style.setProperty('--tickdur', Math.max(18, Math.min(90, len * 0.35)) + 's');
  }

  /* ---------- slides ---------- */
  function resetSlides() {
    if (msgState.slideTimer) { clearTimeout(msgState.slideTimer); msgState.slideTimer = null; }
    msgState.slideIdx = 0;
    el('msgSlide').hidden = true;
    if (msgState.slides.length) scheduleNextSlide(0);
  }
  // Show a slide every SLIDE_GAP of schedule time, for the message's duration.
  const SLIDE_GAP_MS = 25 * 1000;
  function scheduleNextSlide(delay) {
    msgState.slideTimer = setTimeout(showSlide, delay != null ? delay : SLIDE_GAP_MS);
  }
  function showSlide() {
    if (msgState.takeoverActive || !msgState.slides.length) { scheduleNextSlide(); return; }
    const m = msgState.slides[msgState.slideIdx % msgState.slides.length];
    msgState.slideIdx++;
    const card = el('slideCard');
    card.style.setProperty('--tag', m.color);
    el('slideBadge').textContent = BADGE[m.priority] || BADGE.info;
    el('slideBadge').style.background = m.color;
    el('slideTitle').textContent = m.title || '';
    el('slideTitle').hidden = !m.title;
    el('slideMsg').textContent = m.body || '';
    el('slideMsg').hidden = !m.body;
    const img = el('slideImg');
    if (m.image) { img.src = m.image; img.hidden = false; } else { img.hidden = true; img.removeAttribute('src'); }
    el('msgSlide').hidden = false;
    const dur = (m.durationSec || 12) * 1000;
    setTimeout(() => { el('msgSlide').hidden = true; scheduleNextSlide(); }, dur);
  }

  /* ---------- takeover ---------- */
  function handleTakeover() {
    const t = msgState.takeovers[0];
    const box = el('msgTakeover');
    if (t) {
      msgState.takeoverActive = true;
      el('takeoverBadge').textContent = t.priority === 'urgent' ? '⚠ ВАЖНО' : (BADGE[t.priority] || 'СЪОБЩЕНИЕ');
      el('takeoverTitle').textContent = t.title || '';
      el('takeoverTitle').hidden = !t.title;
      el('takeoverMsg').textContent = t.body || '';
      el('takeoverMsg').hidden = !t.body;
      const img = el('takeoverImg');
      if (t.image) { img.src = t.image; img.hidden = false; } else { img.hidden = true; img.removeAttribute('src'); }
      box.hidden = false;
      if (el('msgSlide')) el('msgSlide').hidden = true;
    } else {
      msgState.takeoverActive = false;
      box.hidden = true;
    }
  }

  /* ---------- boot ---------- */
  tickClock();
  setInterval(tickClock, 1000);
  setInterval(renderHeader, 30 * 1000); // refresh current-shift highlight
  loadData(true);
  setInterval(loadData, 20 * 1000);     // poll for new uploads
  loadMessages();
  setInterval(loadMessages, 12 * 1000); // poll for new messages
  window.addEventListener('resize', () => renderAll());
})();
