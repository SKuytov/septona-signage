'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { parseScheduleBuffer } = require('./lib/parseSchedule');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'schedule.json');
// Optional admin key to protect uploads (set ADMIN_KEY env to enable)
const ADMIN_KEY = process.env.ADMIN_KEY || '';

for (const d of [DATA_DIR, UPLOAD_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.xlsx$/i.test(file.originalname) ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    cb(ok ? null : new Error('Само .xlsx файлове са позволени'), ok);
  },
});

app.use(express.static(path.join(ROOT, 'public')));

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
app.post('/api/upload', (req, res) => {
  if (ADMIN_KEY && req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Невалиден администраторски ключ.' });
  }
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

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Septona signage running on http://0.0.0.0:${PORT}`);
  if (ADMIN_KEY) console.log('Admin uploads protected with ADMIN_KEY.');
});
