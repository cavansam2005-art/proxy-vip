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
// API DÀNH CHO CLIENT (Giao diện tím)
// ==========================================

// 3. API lấy IP
app.get('/api/whoami', (req, res) => {
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
  if (ip && ip.startsWith('::ffff:')) ip = ip.substring(7);
  res.json({ ip: ip || "127.0.0.1" });
});

// 4. API Kích hoạt Key
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
    return res.json({ 
      ok: true, 
      message: "Kích hoạt thành công!", 
      expires_at: record.expires_at, 
      expiresAt: new Date(record.expires_at * 1000).toISOString() 
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Lỗi Server." });
  }
});

// 5. API Check trạng thái
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
// TRANG ADMIN & API QUẢN LÝ
// ==========================================

// 6. Giao diện trang Admin
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin - Quản Lý Key Proxy</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; }
        .container { max-width: 1000px; margin: 0 auto; }
        h1 { color: #38bdf8; margin-bottom: 20px; text-align: center; }
        .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px; }
        .btn { padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 15px; transition: 0.2s; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.4); }
        .btn:hover { background: #059669; transform: translateY(-2px); }
        .btn:active { transform: translateY(0); }
        table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
        th, td { padding: 15px; text-align: left; border-bottom: 1px solid #334155; font-size: 14px; }
        th { background: #334155; color: #e2e8f0; font-weight: 600; text-transform: uppercase; font-size: 12px; letter-spacing: 1px; }
        tr:hover { background: #26334d; }
        .key-code { font-family: 'Courier New', monospace; font-weight: bold; color: #fbbf24; font-size: 15px; }
        .status-active { color: #34d399; font-weight: bold; }
        .status-none { color: #94a3b8; }
        .toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #10b981; color: white; padding: 12px 24px; border-radius: 8px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.5); opacity: 0; transition: 0.3s; pointer-events: none; z-index: 999; }
        .toast.show { opacity: 1; top: 30px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Quản Lý Key Proxy VIP</h1>
        <div class="top-bar">
          <button class="btn" onclick="createNewKey()">+ Tạo Key Mới</button>
        </div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Key Code</th>
                <th>Trạng Thái</th>
                <th>Hạn Sử Dụng</th>
                <th>IP Hiện Tại</th>
              </tr>
            </thead>
            <tbody id="keyTableBody">
              <tr><td colspan="4" style="text-align:center;">Đang tải dữ liệu...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="toast" id="toast">Đã tạo key mới thành công!</div>

      <script>
        async function loadKeys() {
          try {
            const res = await fetch('/api/admin/list');
            const data = await res.json();
            const tbody = document.getElementById('keyTableBody');
            
            if (data.length === 0) {
              tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#94a3b8;">Chưa có key nào. Hãy bấm Tạo Key Mới.</td></tr>';
              return;
            }

            tbody.innerHTML = data.map(k => {
              const isActivated = !!k.device_id;
              const expires = k.expires_at ? new Date(k.expires_at * 1000).toLocaleString('vi-VN') : 'Chưa kích hoạt';
              return \`
                <tr>
                  <td class="key-code">\${k.key_code}</td>
                  <td class="\${isActivated ? 'status-active' : 'status-none'}">\${isActivated ? '🟢 Đã dùng' : '⚪ Chưa dùng'}</td>
                  <td>\${expires}</td>
                  <td>\${k.ip || '-'}</td>
                </tr>
              \`;
            }).join('');
          } catch (err) {
            document.getElementById('keyTableBody').innerHTML = '<tr><td colspan="4" style="text-align:center; color:red;">Lỗi tải dữ liệu</td></tr>';
          }
        }

        async function createNewKey() {
          try {
            const res = await fetch('/api/admin/genkey');
            if (res.ok) {
              document.getElementById('toast').classList.add('show');
              setTimeout(() => document.getElementById('toast').classList.remove('show'), 3000);
              loadKeys();
            }
          } catch (err) {
            alert('Lỗi kết nối server');
          }
        }

        loadKeys();
      </script>
    </body>
    </html>
  `);
});

// 7. API lấy danh sách Key cho Admin
app.get('/api/admin/list', (req, res) => {
  const keys = db.prepare('SELECT * FROM keys ORDER BY created_at DESC').all();
  res.json(keys);
});

// 8. API tạo key cho Admin
app.get('/api/admin/genkey', (req, res) => {
  const newKey = generateKey();
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO keys (key_code, created_at) VALUES (?, ?)').run(newKey, now);
  res.json({ ok: true, key: newKey });
});

// 9. Chạy Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server chạy tại cổng ${PORT}`);
});
