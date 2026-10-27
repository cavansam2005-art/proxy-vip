const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database('db.sqlite');
db.exec(`CREATE TABLE IF NOT EXISTS keys (key_code TEXT PRIMARY KEY, ip TEXT, device_id TEXT, expires_at INTEGER, activated_at INTEGER, created_at INTEGER)`);

function generateKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const part = () => Array.from({length: 4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `KEY-${part()}-${part()}-${part()}`;
}

app.get('/api/whoami', (req, res) => {
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
  if (ip && ip.startsWith('::ffff:')) ip = ip.substring(7);
  res.json({ ip: ip || "127.0.0.1" });
});

app.post('/api/activate', (req, res) => {
  try {
    const { key, ip, device_id } = req.body;
    if (!key || !ip || !device_id) return res.status(400).json({ ok: false, message: "Thiếu dữ liệu." });
    const record = db.prepare('SELECT * FROM keys WHERE key_code = ?').get(key);
    if (!record) return res.status(404).json({ ok: false, message: "Key không tồn tại." });
    const now = Math.floor(Date.now() / 1000);
    if (record.device_id && record.device_id !== device_id) {
      return res.status(403).json({ ok: false, message: "Key đã được dùng trên thiết bị khác." });
    }
    if (record.expires_at && now > record.expires_at) {
      return res.status(403).json({ ok: false, message: "Key đã hết hạn sử dụng." });
    }
    db.prepare('UPDATE keys SET ip = ? WHERE key_code = ?').run(ip, key);
    return res.json({ ok: true, message: "Kích hoạt thành công!", expires_at: record.expires_at });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Lỗi Server." });
  }
});

app.post('/api/status', (req, res) => {
  const { key, device_id } = req.body;
  if (!key) return res.json({ state: "none" });
  const record = db.prepare('SELECT * FROM keys WHERE key_code = ?').get(key);
  if (!record || !record.device_id) return res.json({ state: "none" });
  if (record.device_id !== device_id) return res.json({ state: "active", device_conflict: true });
  const now = Math.floor(Date.now() / 1000);
  if (record.expires_at && now > record.expires_at) return res.json({ state: "expired", message: "Key đã hết hạn" });
  res.json({ state: "active", expires_at: record.expires_at });
});

app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin Key</title>
      <style>
        body { font-family: sans-serif; background: #0f172a; color: #fff; padding: 20px; text-align: center; }
        h1 { color: #38bdf8; }
        button { padding: 15px 30px; background: #10b981; color: white; border: none; border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; background: #1e293b; margin-top: 20px; }
        th, td { padding: 12px; border-bottom: 1px solid #334155; text-align: left; font-size: 14px; }
        .key { color: #fbbf24; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>Quản Lý Key</h1>
      <button onclick="taoKey()">+ Tạo Key Mới</button>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Key Code</th><th>Trạng Thái</th><th>IP</th></tr></thead>
          <tbody id="data"></tbody>
        </table>
      </div>
      <script>
        async function load() {
          const r = await fetch('/api/admin/list');
          const d = await r.json();
          document.getElementById('data').innerHTML = d.map(k => `
            <tr>
              <td class="key">${k.key_code}</td>
              <td>${k.device_id ? '🟢 Đã dùng' : '⚪ Chưa dùng'}</td>
              <td>${k.ip || '-'}</td>
            </tr>
          `).join('');
        }
        async function taoKey() {
          await fetch('/api/admin/genkey');
          load();
        }
        load();
      </script>
    </body>
    </html>
  `);
});

app.get('/api/admin/list', (req, res) => {
  res.json(db.prepare('SELECT * FROM keys ORDER BY created_at DESC').all());
});

app.get('/api/admin/genkey', (req, res) => {
  const newKey = generateKey();
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO keys (key_code, created_at) VALUES (?, ?)').run(newKey, now);
  res.json({ ok: true, key: newKey });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server chạy tại cổng ${PORT}`);
});
