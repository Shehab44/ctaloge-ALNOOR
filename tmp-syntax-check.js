const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const scriptMatch = html.match(/<script[^>]*>([\s\S]*)<\/script>/i);
if (!scriptMatch) {
  console.error('No <script> tag found');
  process.exit(1);
}
const code = scriptMatch[1];
try {
  new Function(code);
  console.log('syntax ok');
} catch (err) {
  console.error(err.stack || err);
  process.exit(1);
}
