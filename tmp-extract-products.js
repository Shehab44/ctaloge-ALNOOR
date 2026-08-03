const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/const PRODUCTS=(\[[\s\S]*?\]);/);
if (!match) {
  console.error('PRODUCTS array not found');
  process.exit(1);
}
const data = JSON.parse(match[1]);
fs.writeFileSync('products.json', JSON.stringify(data, null, 2), 'utf8');
console.log('wrote products.json with', data.length, 'items');
