const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const app = express();
app.use(cors()); // Cho phép gọi API từ GitHub Pages
app.use(express.json());

// Khởi tạo Database (Lưu file db.sqlite)
const db = new Database('db.sqlite');
db.exec(`
  CREATE TABLE IF NOT EXISTS keys (
    key_code TEXT PRIMARY KEY,
    ip TEXT,
    device_id TEXT,
    expires_at INTEGER,
    activated_at INTEGER
  )
`);

// Hàm tạo key ngẫu nhiên (Dùng để test)
function generateKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const part = () => Array.from({length: 4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `KEY-${part()}-${part()}-${part()}`;
}

// Tạo sẵn 1 key test trong DB nếu chưa có
const testKey = "KEY-TEST-1234-ABCD";
if (!db.prepare('SELECT * FROM keys WHERE key_code = ?').get(testKey)) {
  // Hạn sử dụng 30 ngày tính từ lúc kích hoạt
  db.prepare('INSERT INTO keys (key_code) VALUES (?)').run(testKey);
  console.log(`✅ Đã tạo sẵn Key test: ${testKey}`);
}

// ==========================================
// 1. API LẤY IP (Giao diện gọi vào /api/whoami)
// ==========================================
app.get('/api/whoami', (req, res) => {
  // Lấy IP thật của client (kể cả khi qua proxy/render)
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
  if (ip && ip.startsWith('::ffff:')) ip = ip.substring(7); // Xoá prefix IPv6
  
  res.json({ ip: ip || "127.0.0.1" });
});

// ==========================================
// 2. API KÍCH HOẠT KEY (Giao diện gọi vào /api/activate)
// ==========================================
app.post('/api/activate', (req, res) => {
  const { key, ip, device_id } = req.body;

  if (!key || !ip || !device_id) {
    return res.status(400).json({ ok: false, message: "Thiếu dữ liệu yêu cầu." });
  }

  const record = db.prepare('SELECT * FROM keys WHERE key_code = ?').get(key);

  // 1. Kiểm tra Key có tồn tại không
  if (!record) {
    return res.status(404).json({ ok: false, message: "Key không tồn tại trên hệ thống." });
  }

  const now = Math.floor(Date.now() / 1000); // Thời gian hiện tại (giây)

  // 2. Nếu Key đã được kích hoạt trước đó
  if (record.device_id) {
    // Kiểm tra xem có đúng thiết bị cũ không
    if (record.device_id !== device_id) {
      return res.status(403).json({ ok: false, message: "Key này đã được kích hoạt trên thiết bị khác." });
    }
    // Nếu đúng thiết bị, kiểm tra hạn sử dụng
    if (record.expires_at && now > record.expires_at) {
      return res.status(403).json({ ok: false, message: "Key đã hết hạn sử dụng." });
    }
    
    // Nếu đúng thiết bị và còn hạn -> Cập nhật lại IP mới (nếu thay đổi mạng) và trả về OK
    db.prepare('UPDATE keys SET ip = ? WHERE key_code = ?').run(ip, key);
    return res.json({ 
      ok: true, 
      message: "Gia hạn/Cập nhật IP thành công!", 
      expires_at: record.expires_at,
      expiresAt: new Date(record.expires_at * 1000).toISOString()
    });
  }

  // 3. Nếu Key chưa kích hoạt (Kích hoạt lần đầu)
  // Mặc định cộng 30 ngày (30 * 24 * 60 * 60 giây)
  const durationDays = 30; 
  const expires_at = now + (durationDays * 24 * 60 * 60);

  db.prepare('UPDATE keys SET ip = ?, device_id = ?, expires_at = ?, activated_at = ? WHERE key_code = ?')
    .run(ip, device_id, expires_at, now, key);

  res.json({ 
    ok: true, 
    message: `Kích hoạt thành công (${durationDays} ngày)!`, 
    expires_at: expires_at,
    expiresAt: new Date(expires_at * 1000).toISOString()
  });
});

// ==========================================
// 3. API KIỂM TRA TRẠNG THÁI (Giao diện gọi vào /api/status)
// ==========================================
app.post('/api/status', (req, res) => {
  const { key, device_id } = req.body;
  
  if (!key) return res.status(400).json({ state: "none" });

  const record = db.prepare('SELECT * FROM keys WHERE key_code = ?').get(key);
  
  if (!record || !record.device_id) {
    return res.json({ state: "none" }); // Chưa kích hoạt
  }

  if (record.device_id !== device_id) {
    return res.json({ state: "active", device_conflict: true }); // Bị dùng trên máy khác
  }

  const now = Math.floor(Date.now() / 1000);
  if (record.expires_at && now > record.expires_at) {
    return res.json({ state: "expired", message: "Key đã hết hạn" });
  }

  res.json({ 
    state: "active", 
    expires_at: new Date(record.expires_at * 1000).toISOString(),
    ip_matches: record.ip === req.body.ip // Trả về để frontend báo đổi IP
  });
});

// Route test để tự động tạo key mới
app.get('/api/genkey', (req, res) => {
  const newKey = generateKey();
  db.prepare('INSERT INTO keys (key_code) VALUES (?)').run(newKey);
  res.json({ key: newKey });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server API đang chạy tại cổng ${PORT}`);
  console.log(`🔑 Key test của bạn là: KEY-TEST-1234-ABCD`);
});
