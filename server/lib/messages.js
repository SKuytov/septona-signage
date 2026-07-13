'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const MSG_FILE = path.join(DATA_DIR, 'messages.json');
const MEDIA_DIR = path.join(ROOT, 'public', 'media');

for (const d of [DATA_DIR, MEDIA_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

const VALID_MODES = ['banner', 'slide', 'takeover'];
const VALID_PRIORITIES = ['info', 'warning', 'urgent'];
const PRIORITY_COLORS = { info: '#3fa9f5', warning: '#ffb020', urgent: '#ff4d4d' };

function readAll() {
  if (!fs.existsSync(MSG_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(MSG_FILE, 'utf8')); }
  catch (e) { return []; }
}

function writeAll(list) {
  fs.writeFileSync(MSG_FILE, JSON.stringify(list, null, 2));
}

// Messages that are currently active (within start/expiry window)
function activeMessages(now) {
  const t = now ? new Date(now).getTime() : Date.now();
  return readAll().filter((m) => {
    const start = m.startAt ? new Date(m.startAt).getTime() : -Infinity;
    const end = m.expireAt ? new Date(m.expireAt).getTime() : Infinity;
    return t >= start && t <= end;
  }).sort((a, b) => {
    // urgent first, then by createdAt desc
    const rank = { urgent: 0, warning: 1, info: 2 };
    if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

// Save an optional image buffer, return public path or null
function saveImage(buffer, originalName) {
  if (!buffer) return null;
  const ext = (path.extname(originalName || '').toLowerCase().match(/\.(png|jpe?g|gif|webp)$/) || ['.png'])[0];
  const name = crypto.randomBytes(8).toString('hex') + ext;
  fs.writeFileSync(path.join(MEDIA_DIR, name), buffer);
  return '/media/' + name;
}

function createMessage({ title, body, priority, mode, startAt, expireAt, durationSec }, imageBuffer, imageName) {
  priority = VALID_PRIORITIES.includes(priority) ? priority : 'info';
  mode = VALID_MODES.includes(mode) ? mode : 'slide';
  const msg = {
    id: crypto.randomBytes(6).toString('hex'),
    title: (title || '').trim(),
    body: (body || '').trim(),
    priority,
    color: PRIORITY_COLORS[priority],
    mode,
    image: saveImage(imageBuffer, imageName),
    startAt: startAt || null,
    expireAt: expireAt || null,
    durationSec: Number(durationSec) > 0 ? Number(durationSec) : 12,
    createdAt: new Date().toISOString(),
  };
  if (!msg.title && !msg.body && !msg.image) {
    throw new Error('Съобщението трябва да има заглавие, текст или изображение.');
  }
  const list = readAll();
  list.push(msg);
  writeAll(list);
  return msg;
}

function deleteMessage(id) {
  const list = readAll();
  const idx = list.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  const [removed] = list.splice(idx, 1);
  // clean up image file
  if (removed.image) {
    const f = path.join(ROOT, 'public', removed.image.replace(/^\//, ''));
    if (fs.existsSync(f)) { try { fs.unlinkSync(f); } catch (e) {} }
  }
  writeAll(list);
  return true;
}

function lastModified() {
  try { return fs.statSync(MSG_FILE).mtime.toISOString(); }
  catch (e) { return null; }
}

module.exports = {
  readAll, activeMessages, createMessage, deleteMessage, lastModified,
  VALID_MODES, VALID_PRIORITIES, PRIORITY_COLORS,
};
