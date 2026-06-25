const fs = require('fs');
const path = require('path');

// 讀取 .env 檔案或系統環境變數並解析
const envPath = path.join(__dirname, '.env');
let url = process.env.SUPABASE_URL || "";
let anonKey = process.env.SUPABASE_ANON_KEY || "";

if ((!url || !anonKey) && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const lines = envContent.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      // 合併其餘部分以防止金鑰內有等號
      const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      if (key === 'SUPABASE_URL' && !url) {
        url = val;
      } else if (key === 'SUPABASE_ANON_KEY' && !anonKey) {
        anonKey = val;
      }
    }
  }
}

// 產生前端可載入的 config.js
const configContent = `// Supabase 後端連線設定
// 此檔案由 build-config.js 自動從 .env 產生，請勿直接手動編輯此檔案。
const SUPABASE_CONFIG = {
  url: "${url}",
  anonKey: "${anonKey}"
};
`;

fs.writeFileSync(path.join(__dirname, 'config.js'), configContent, 'utf8');
console.log('---');
console.log('成功從 .env 變數中重新產生 config.js 檔案！');
console.log(`URL: ${url ? url : '(尚未填寫)'}`);
console.log(`Anon Key: ${anonKey ? '已載入' : '(尚未填寫)'}`);
console.log('---');
