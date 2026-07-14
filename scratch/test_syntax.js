const fs = require('fs');
const content = fs.readFileSync('js/modules/plan.js', 'utf8');

const queries = ['getPlanCoverHtml', 'getPlanCoverColor'];
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (queries.some(q => line.includes(q))) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
