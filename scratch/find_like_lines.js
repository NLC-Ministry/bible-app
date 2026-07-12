import fs from 'fs';

const content = fs.readFileSync('c:\\Users\\admin\\Desktop\\Bible-study\\js\\modules\\home.js', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
  if (line.includes('async function syncVerseLikes') || line.includes('async function toggleVerseLike')) {
    console.log(`Line ${idx + 1}: ${line}`);
    // Print 10 lines from here
    for (let i = 0; i < 15; i++) {
      console.log(`  L${idx + 1 + i}: ${lines[idx + i]}`);
    }
  }
});
