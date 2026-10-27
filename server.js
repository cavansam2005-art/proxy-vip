const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();

// Cấu hình CORS: Cho phép GitHub Pages của bạn gọi API, chặn web khác
app.use(cors({
  origin: ['https://cavansam2005-art.github.io', 'http://localhost:3000'], 
  methods: ['GET', 'POST']
}));
app.use(express.json());

// Khởi tạo Database (Lưu vào file db.sqlite)
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

// Tạo key ngẫu nhiên
function generateKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const part = () => Array.from({length: 4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `KEY-${part()}-${part()}-${part()}`;
}

// ==========================================
// CÁC API DÀNH CHO CLIENT (Giao diện)
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
    
    // Kiểm tra thiết bị
    if (record.device_id && record.device_id !== device_id) {
      return res.status(403).json({ ok: false, message: "Key đã được dùng trên thiết bị khác." });
    }
    // Kiểm tra hạn sử dụng
    if (record.expires_at && now > record.expires_at) {
      return res.status(403).json({ ok: false, message: "Key đã hết hạn sử dụng." });
    }
    
    // Nếu hợp lệ, cập nhật lại IP
    db.prepare('UPDATE keys SET ip = ? WHERE key_code = ?').run(ip, key);
    return res.json({ 
      ok: true, 
      message: "Kích hoạt/Cập nhật IP thành công!", 
      expires_at: record.expires_at, 
      expiresAt: new Date(record.expires_at * 1000).toISOString() 
    });
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
// TRANG ADMIN QUẢN LÝ (Dành riêng cho bạn)
// ==========================================
app.get('/admin', (req, res) => {
  const keys = db.prepare('SELECT * FROM keys ORDER BY created_at DESC').all();
  
  let rows = keys.map(k => {
    const isActivated = !!k.device_id;
    const expires = k.expires_at ? new Date(k.expires_at * 1000).toLocaleString('vi-VN') : 'Chưa kích hoạt';
    return `
      <tr>
        <td><b>${k.key_code}</b></td>
        <td>${isActivated ? '🟢 Đã dùng' : '⚪ Chưa dùng'}</td>
        <td>${expires}</td>
        <td>${k.ip || '-'}</td>
        <td>${k.device_id ? k.device_id.substring(0,8) : '-'}</td>
      </tr>
    `;
  }).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin - Quản lý Key</title>
      <style>
        body { font-family: sans-serif; background: #f4f4f9; padding: 20px; }
        h1 { color: #333; }
        .btn { padding: 10px 15px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer; text-decoration: none; display: inline-block; margin-bottom: 15px; }
        table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #007bff; color: white; }
        tr:hover { background: #f1f1f1; }
      </style>
    </head>
    <body>
      <h1>Quản Lý Key Proxy</h1>
      <a href="/api/admin/genkey" class="btn">+ Tạo Key Mới</a>
      <table>
        <thead>
          <tr>
            <th>Key Code</th>
            <th>Trạng Thái</th>
            <th>Hạn Sử Dụng</th>
            <th>IP Hiện Tại</th>
            <th>Device ID</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="5">Chưa có key nào.</td></tr>'}
        </tbody>
      </table>
    </body>
    </html>
  `);
});

// API Tạo Key dành cho Admin
app.get('/api/admin/genkey', (req, res) => {
  const newKey = generateKey();
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO keys (key_code, created_at) VALUES (?, ?)').run(newKey, now);
  res.redirect('/admin'); // Tạo xong tự quay lại trang Admin
});

// Bắt buộc phải có '0.0.0.0' thì Render mới chạy được
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server API đang chạy tại cổng ${PORT}`);
});
