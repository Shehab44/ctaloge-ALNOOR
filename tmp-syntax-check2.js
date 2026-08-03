const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
let match;
let idx = 0;
let errors = false;
while ((match = scriptRegex.exec(html)) !== null) {
  const attrs = match[1];
  const content = match[2];
  if (/\ssrc\s*=/.test(attrs)) continue;
  idx += 1;
  try {
    new Function(content);
    console.log(`script ${idx}: ok`);
  } catch (err) {
    console.error(`script ${idx}: ${err.message}`);
    console.error(err.stack);
    errors = true;
    break;
  }
}
if (!idx) {
  console.error('no inline scripts found');
  process.exit(1);
}
if (!errors) console.log('all inline scripts syntax ok');
