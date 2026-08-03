import fs from 'fs';

let content = fs.readFileSync('index.html', 'utf8');
content = content.replace(/\r?\n\s*title="黃色螢光筆"[\s\S]*?<\/div>/g, '');
fs.writeFileSync('index.html', content);
console.log('Cleaned index.html successfully!');
