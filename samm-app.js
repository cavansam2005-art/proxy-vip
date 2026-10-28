// File phụ trợ kết nối App Alok với Server SAMM
document.addEventListener('DOMContentLoaded', () => {
    // 1. Tự động đổi tên trên toàn bộ giao diện
    document.title = document.title.replace(/nminhios modz/gi, 'SAMM X MODZ');
    document.querySelectorAll('.brand-name, .brand-subtitle, .nv-kicker, footer span').forEach(el => {
        if(el.innerText.includes('nminhios modz')) {
            el.innerText = el.innerText.replace(/nminhios modz/gi, 'SAMM X MODZ');
        }
    });

    // 2. Ghi đè hàm kiểm tra Key để gọi lên Server Render
    setTimeout(() => {
        window.verifyKey = async function(value) {
            try {
                const response = await fetch('https://api-proxy-18ww.onrender.com/api/verify-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: String(value).trim() })
                });
                const data = await response.json();
                return data.ok === true;
            } catch (error) {
                console.error("Lỗi kết nối Server:", error);
                return false;
            }
        };
    }, 1000);
});
