'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { parseScheduleBuffer } = require('./lib/parseSchedule');
const messages = require('./lib/messages');

const ROOT = path.join(__dirname, '..');

// Minimal .env loader (no dependency): populate process.env from ROOT/.env if present.
(function loadEnv() {
  try {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch (e) { /* ignore malformed .env */ }
})();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'schedule.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PUBLIC_DIR = path.join(ROOT, 'public');

// Display timing settings (seconds). Adjustable from the admin panel.
const DEFAULT_SETTINGS = {
  sectionRotateSec: 20,   // how long each цех/section stays on screen
  scrollPauseSec: 3.5,    // pause at the top & bottom of a scrolling worker list
  scrollSpeedPx: 7,       // worker-list scroll speed (px/sec)
  slideGapSec: 25,        // gap between full-screen message slides
  slideDurationSec: 12,   // default full-screen slide duration (per-message value wins)
};
function readSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    }
  } catch (e) { /* fall through to defaults */ }
  return { ...DEFAULT_SETTINGS };
}
function writeSettings(patch) {
  const cur = readSettings();
  const next = { ...cur };
  const clampNum = (v, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
  };
  const rules = {
    sectionRotateSec: [5, 600], scrollPauseSec: [0, 60], scrollSpeedPx: [1, 200],
    slideGapSec: [5, 3600], slideDurationSec: [3, 300],
  };
  for (const [k, [min, max]] of Object.entries(rules)) {
    if (patch[k] !== undefined && patch[k] !== '' && patch[k] !== null) {
      const v = clampNum(patch[k], min, max);
      if (v !== null) next[k] = v;
    }
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}
// Optional admin key to protect the admin pages + uploads (set ADMIN_KEY env to enable)
const ADMIN_KEY = process.env.ADMIN_KEY || '';
// Secret used to sign the login cookie. Defaults to a value derived from ADMIN_KEY;
// set SESSION_SECRET to invalidate sessions independently / across restarts consistently.
const SESSION_SECRET = process.env.SESSION_SECRET ||
  (ADMIN_KEY ? crypto.createHash('sha256').update('septona:' + ADMIN_KEY).digest('hex') : '');
const COOKIE_NAME = 'septona_admin';
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

// Pages that require an authenticated admin session.
const PROTECTED_PAGES = new Set(['/admin.html', '/messages.html', '/editor.html', '/admin', '/messages', '/editor']);

for (const d of [DATA_DIR, UPLOAD_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

// ---------------- AUTH HELPERS ----------------

function signSession(expMs) {
  const payload = String(expMs);
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return payload + '.' + sig;
}

function verifySession(token) {
  if (!token || !SESSION_SECRET) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  // constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && Date.now() < exp;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

// True if the request carries a valid session cookie OR the correct x-admin-key header.
function isAuthed(req) {
  if (!ADMIN_KEY) return true; // auth disabled when no key configured
  if (req.headers['x-admin-key'] && req.headers['x-admin-key'] === ADMIN_KEY) return true;
  const cookies = parseCookies(req);
  return verifySession(cookies[COOKIE_NAME]);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.xlsx$/i.test(file.originalname) ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    cb(ok ? null : new Error('Само .xlsx файлове са позволени'), ok);
  },
});

// Separate uploader for message images
const imgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(png|jpe?g|gif|webp)$/i.test(file.originalname) || /^image\//.test(file.mimetype);
    cb(ok ? null : new Error('Само изображения (png, jpg, gif, webp) са позволени'), ok);
  },
});

function requireAdmin(req, res, next) {
  if (!isAuthed(req)) {
    return res.status(401).json({ error: 'Невалиден или изтекъл администраторски достъп.' });
  }
  next();
}

app.use(express.json({ limit: '5mb' })); // schedule editor can post a large payload
app.use(express.urlencoded({ extended: false, limit: '5mb' }));

// ---------------- LOGIN / LOGOUT ----------------

// Login form posts { key }. On success set a signed httpOnly session cookie.
app.post('/api/login', (req, res) => {
  if (!ADMIN_KEY) return res.json({ ok: true }); // auth disabled
  const key = (req.body && req.body.key) || '';
  const a = Buffer.from(String(key));
  const b = Buffer.from(ADMIN_KEY);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Грешен ключ.' });
  const exp = Date.now() + SESSION_MAX_AGE_MS;
  const token = signSession(exp);
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.secure;
  res.cookie
    ? res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_MAX_AGE_MS })
    : res.setHeader('Set-Cookie',
        `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}${secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

// Lets the page check whether a login is required / current auth state.
app.get('/api/auth-status', (req, res) => {
  res.json({ required: !!ADMIN_KEY, authed: isAuthed(req) });
});

// ---------------- PAGE GUARD ----------------
// Gate the admin pages BEFORE static serving. Unauthenticated -> redirect to login.
app.get(['/admin.html', '/messages.html', '/editor.html', '/admin', '/messages', '/editor'], (req, res) => {
  let file = 'admin.html';
  if (req.path.indexOf('messages') > -1) file = 'messages.html';
  else if (req.path.indexOf('editor') > -1) file = 'editor.html';
  if (!isAuthed(req)) {
    return res.redirect('/login.html?next=' + encodeURIComponent('/' + file));
  }
  res.sendFile(path.join(PUBLIC_DIR, file));
});

app.use(express.static(PUBLIC_DIR));

// Current schedule (for the display)
app.get('/api/schedule', (req, res) => {
  if (!fs.existsSync(DATA_FILE)) return res.status(404).json({ error: 'Няма зареден график все още.' });
  res.set('Cache-Control', 'no-store');
  res.sendFile(DATA_FILE);
});

// Metadata only (lightweight polling for auto-refresh)
app.get('/api/status', (req, res) => {
  if (!fs.existsSync(DATA_FILE)) return res.json({ loaded: false });
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    res.json({ loaded: true, period: d.period, parsedAt: d.parsedAt, grandTotal: d.grandTotal });
  } catch (e) { res.json({ loaded: false }); }
});

// Upload + parse a new weekly xlsx
app.post('/api/upload', requireAdmin, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Няма качен файл.' });
    try {
      const data = await parseScheduleBuffer(req.file.buffer);
      // archive raw upload
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(UPLOAD_DIR, `${stamp}.xlsx`), req.file.buffer);
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
      res.json({
        ok: true, period: data.period, grandTotal: data.grandTotal,
        sections: data.sections.map((s) => ({ name: s.name, total: s.total, shifts: s.shifts.map((x) => x.count) })),
        lines: data.lines.map((l) => ({ name: l.name, color: l.color })),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Грешка при обработка на файла: ' + e.message });
    }
  });
});

// Save an edited schedule (from the admin editor): move people across shifts,
// change per-person bus line + color, edit the line legend/colors.
// Recomputes counts/totals + re-derives lineNo from the (possibly edited) lines.
app.post('/api/schedule', requireAdmin, (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.sections)) {
      return res.status(400).json({ error: 'Невалидни данни: липсват цехове (sections).' });
    }
    const prev = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : {};

    const clean = (v) => (v == null ? '' : String(v));
    const cleanColor = (c) => {
      const s = clean(c).trim();
      return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s.toUpperCase() : '#FFFFFF';
    };

    // Rebuild the line legend from the edited payload (name -> {color, lineNo}).
    const linesIn = Array.isArray(body.lines) ? body.lines : (prev.lines || []);
    const lines = linesIn
      .map((l) => ({ name: clean(l.name).trim(), color: cleanColor(l.color) }))
      .filter((l) => l.name);
    lines.forEach((l, i) => { l.lineNo = i + 1; });
    const lineByName = new Map(lines.map((l) => [l.name, l]));

    // Rebuild sections/shifts/workers with recomputed counts.
    const sections = body.sections.map((sec, si) => {
      const shifts = (Array.isArray(sec.shifts) ? sec.shifts : []).map((sh, shi) => {
        const workers = (Array.isArray(sh.workers) ? sh.workers : []).map((w) => {
          const lineName = clean(w.line).trim();
          const legend = lineByName.get(lineName);
          // per-person color: explicit color wins, else inherit from the line legend
          const color = w.color ? cleanColor(w.color) : (legend ? legend.color : '#FFFFFF');
          return {
            name: clean(w.name).trim(),
            location: clean(w.location).trim(),
            line: lineName,
            color,
            lineNo: legend ? legend.lineNo : null,
          };
        }).filter((w) => w.name);
        // renumber the per-worker sequence within the shift
        workers.forEach((w, i) => { w.num = i + 1; });
        return {
          index: typeof sh.index === 'number' ? sh.index : shi,
          label: clean(sh.label) || `СМЯНА ${shi + 1}`,
          time: clean(sh.time),
          workers,
          count: workers.length,
        };
      });
      const total = shifts.reduce((a, s) => a + s.count, 0);
      return {
        id: sec.id != null ? sec.id : si,
        name: clean(sec.name).trim() || `ЦЕХ ${si + 1}`,
        shifts,
        total,
      };
    });

    const grandTotal = sections.reduce((a, s) => a + s.total, 0);
    const data = {
      title: prev.title || body.title || 'Производствен график',
      period: clean(body.period) || prev.period || '',
      grandTotal,
      parsedAt: new Date().toISOString(),
      lines,
      sections,
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    res.json({ ok: true, grandTotal, sections: sections.map((s) => ({ name: s.name, total: s.total })) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Грешка при запис: ' + e.message });
  }
});

// ---------------- SETTINGS (display timings) ----------------

// Public: the display reads timings from here.
app.get('/api/settings', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(readSettings());
});

// Admin: update timings.
app.post('/api/settings', requireAdmin, (req, res) => {
  try {
    const next = writeSettings(req.body || {});
    res.json({ ok: true, settings: next });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------------- MESSAGES ----------------

// Active messages for the display
app.get('/api/messages', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ messages: messages.activeMessages(), updatedAt: messages.lastModified() });
});

// All messages (for admin management)
app.get('/api/messages/all', requireAdmin, (req, res) => {
  res.json({ messages: messages.readAll() });
});

// Create a message (multipart: fields + optional image)
app.post('/api/messages', requireAdmin, (req, res) => {
  imgUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const msg = messages.createMessage(
        req.body,
        req.file ? req.file.buffer : null,
        req.file ? req.file.originalname : null
      );
      res.json({ ok: true, message: msg });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
});

// Delete a message
app.delete('/api/messages/:id', requireAdmin, (req, res) => {
  const ok = messages.deleteMessage(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Съобщението не е намерено.' });
  res.json({ ok: true });
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Septona signage running on http://0.0.0.0:${PORT}`);
  if (ADMIN_KEY) console.log('Admin pages + API protected with ADMIN_KEY (login at /login.html).');
  else console.warn('WARNING: ADMIN_KEY not set — admin pages are OPEN. Set ADMIN_KEY to protect them.');
});
