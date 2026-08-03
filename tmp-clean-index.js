const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(filePath, 'utf8');

const productsRegex = /const PRODUCTS=\[[\s\S]*?\];\s*/;
if (!productsRegex.test(html)) {
  throw new Error('PRODUCTS block not found in index.html');
}
html = html.replace(productsRegex, '');

html = html.replace(/if\(Array\.isArray\(rows\) && rows\.length\)\{[\s\S]*?\} else \{[\s\S]*?\}/, `if(Array.isArray(rows) && rows.length){\n      DATA=rows.map(p=>({...p, image_url:normalizeRelativeImagePath(p.image_url||'')}));\n    } else {\n      DATA=[];\n    }`);

html = html.replace(/\}catch\(err\)\{[\s\S]*?console\.warn\('فشل تحميل البيانات من الخادم، سيتم استخدام البيانات المحلية:', err\);[\s\S]*?\}/, `}catch(err){\n    console.warn('فشل تحميل البيانات من الخادم:', err);\n    DATA=[];\n  }`);

fs.writeFileSync(filePath, html, 'utf8');
console.log('index.html cleaned');
