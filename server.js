const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Khởi tạo Database
const db = new Database('db.sqlite');
db.exec(`
  CREATE TABLE IF NOT EXISTS keys (
    key_code TEXT PRIMARY KEY,
    ip TEXT,
    device_id TEXT,
    expires_at INTEGER,
    activated_at INTEGER,
    created_at INTEGER
  )
`);

// 2. Hàm tạo Key
function generateKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const part = () => Array.from({length: 4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `KEY-${part()}-${part()}-${part()}`;
}

// ==========================================
// API CHO GIAO DIỆN
// ==========================================
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
    return res.json({ ok: true, message: "Kích hoạt thành công!", expires_at: record.expires_at, expiresAt: new Date(record.expires_at * 1000).toISOString() });
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
  res.json({ state: "active", expires_at: new Date(record.expires_at * 1000).toISOString(), ip_matches: record.ip === req.body.ip });
});

// ==========================================
// TRANG ADMIN (Giao diện quản lý)
// ==========================================
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin - Quản Lý Key</title>
      <style>
        body { font-family: sans-serif; background: #0f172a; color: #fff; padding: 20px; }
        h1 { color: #38bdf8; text-align: center; }
        .btn { padding: 12px 20px; background: #10b981; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 16px; display: block; margin: 0 auto 20px; }
        table { width: 100%; border-collapse: collapse; background: #1e293b; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #334155; font-size: 14px; }
        th { background: #334155; color: #e2e8f0; }
        .key { color: #fbbf24; font-weight: bold; font-family: monospace; }
        .active { color: #34d399; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>Quản Lý Key Proxy</h1>
      <button class="btn" onclick="taoKey()">+ Tạo Key Mới</button>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Key Code</th>
              <th>Trạng Thái</th>
              <th>Hạn Sử Dụng</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody id="tableBody">
            <tr><td colspan="4" style="text-align:center;">Đang tải...</td></tr>
          </tbody>
        </table>
      </div>

      <script>
        async function loadData() {
          try {
            const res = await fetch('/api/admin/list');
            const data = await res.json();
            const tbody = document.getElementById('tableBody');
            
            if (data.length === 0) {
              tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Chưa có key nào. Bấm nút phía trên để tạo.</td></tr>';
              return;
            }

            tbody.innerHTML = data.map(k => {
              const isAct = !!k.device_id;
              const exp = k.expires_at ? new Date(k.expires_at * 1000).toLocaleString('vi-VN') : 'Chưa kích hoạt';
              return \`
                <tr>
                  <td class="key">\${k.key_code}</td>
                  <td class="\${isAct ? 'active' : ''}">\${isAct ? '🟢 Đã dùng' : '⚪ Chưa dùng'}</td>
                  <td>\${exp}</td>
                  <td>\${k.ip || '-'}</td>
                </tr>
              \`;
            }).join('');
          } catch (e) {
            document.getElementById('tableBody').innerHTML = '<tr><td colspan="4" style="color:red;text-align:center;">Lỗi kết nối Server!</td></tr>';
          }
        }

        async function taoKey() {
          try {
            await fetch('/api/admin/genkey');
            loadData();
          } catch (e) {
            alert('Lỗi không tạo được key!');
          }
        }

        loadData();
      </script>
    </body>
    </html>
  `);
});

app.get('/api/admin/list', (req, res) => {
  const keys = db.prepare('SELECT * FROM keys ORDER BY created_at DESC').all();
  res.json(keys);
});

app.get('/api/admin/genkey', (req, res) => {
  const newKey = generateKey();
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO keys (key_code, created_at) VALUES (?, ?)').run(newKey, now);
  res.json({ ok: true, key: newKey });
});

// 3. Chạy Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server chạy tại cổng ${PORT}`);
});
