const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const rootDir = __dirname;
const imagesDir = path.join(rootDir, 'images');

if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

const dbPath = path.join(rootDir, 'catalog.sqlite');
const db = new DatabaseSync(dbPath);

function normalizeKeyPart(value) {
  return String(value || '').trim().toLowerCase();
}

function buildItemKey(product) {
  return [product.warehouse, product.code, product.package_code, product.barcode]
    .map(normalizeKeyPart)
    .join('|');
}

function safeImageNamePart(v) {
  if (!v || v === 'null' || v === '-') return '';
  return String(v).trim().replace(/[^a-zA-Z0-9\-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function buildImageFileName(product) {
  const code = safeImageNamePart(product.code);
  const pkg = safeImageNamePart(product.package_code);
  if (pkg && code) return `${pkg}_${code}`;
  return code || pkg || 'item';
}

function normalizeProduct(product) {
  return {
    name: String(product?.name || ''),
    code: String(product?.code || ''),
    package_code: String(product?.package_code || ''),
    barcode: String(product?.barcode || ''),
    qty_pcs: Number(product?.qty_pcs || 0),
    box_fill: Number(product?.box_fill || 1),
    qty_boxes: Number(product?.qty_boxes || 0),
    warehouse: String(product?.warehouse || ''),
    image_url: String(product?.image_url || '')
  };
}

function processAndSaveImage(product) {
  const imgUrl = String(product.image_url || '').trim();

  if (imgUrl.startsWith('data:image/')) {
    const matches = imgUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (matches) {
      const extRaw = matches[1].toLowerCase();
      const ext = extRaw === 'jpeg' ? 'jpg' : extRaw;
      const baseName = buildImageFileName(product);
      const fileName = `${baseName}.${ext}`;
      const filePath = path.join(imagesDir, fileName);
      const buffer = Buffer.from(matches[2], 'base64');

      fs.writeFileSync(filePath, buffer);
      return `images/${fileName}`;
    }
  }

  if (imgUrl.startsWith('images/')) {
    const filePath = path.join(rootDir, imgUrl.replace(/^\/+/, ''));
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return imgUrl;
    }
  }

  return '';
}

function cleanupMissingImageUrls() {
  const rows = db.prepare('SELECT id, image_url FROM products WHERE image_url IS NOT NULL AND image_url != ""').all();
  const update = db.prepare('UPDATE products SET image_url = "" WHERE id = ?');
  for (const row of rows) {
    const filePath = path.join(rootDir, row.image_url.replace(/^\/+/, ''));
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      update.run(row.id);
    }
  }
}

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_key TEXT UNIQUE,
      name TEXT,
      code TEXT,
      package_code TEXT,
      barcode TEXT,
      qty_pcs REAL,
      box_fill REAL,
      qty_boxes REAL,
      warehouse TEXT,
      image_url TEXT
    );
  `);

  const count = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  if (count > 0) return;

  const jsonPath = path.join(rootDir, 'products.json');
  if (!fs.existsSync(jsonPath)) return;

  const products = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!Array.isArray(products)) return;

  const upsert = db.prepare(`
    INSERT INTO products (item_key, name, code, package_code, barcode, qty_pcs, box_fill, qty_boxes, warehouse, image_url)
    VALUES (@item_key, @name, @code, @package_code, @barcode, @qty_pcs, @box_fill, @qty_boxes, @warehouse, @image_url)
    ON CONFLICT(item_key) DO UPDATE SET
      name=excluded.name,
      code=excluded.code,
      package_code=excluded.package_code,
      barcode=excluded.barcode,
      qty_pcs=excluded.qty_pcs,
      box_fill=excluded.box_fill,
      qty_boxes=excluded.qty_boxes,
      warehouse=excluded.warehouse,
      image_url=excluded.image_url
  `);

  for (const item of products) {
    const normalized = normalizeProduct(item);
    normalized.item_key = buildItemKey(normalized);
    normalized.image_url = processAndSaveImage(normalized);
    upsert.run(normalized);
  }
}

function listProducts() {
  return db.prepare(`
    SELECT name, code, package_code, barcode, qty_pcs, box_fill, qty_boxes, warehouse, image_url
    FROM products
    ORDER BY warehouse, name
  `).all().map(row => ({
    name: row.name,
    code: row.code,
    package_code: row.package_code,
    barcode: row.barcode,
    qty_pcs: row.qty_pcs,
    box_fill: row.box_fill,
    qty_boxes: row.qty_boxes,
    warehouse: row.warehouse,
    image_url: row.image_url
  }));
}

function upsertProduct(product) {
  const normalized = normalizeProduct(product);
  normalized.item_key = buildItemKey(normalized);
  normalized.image_url = processAndSaveImage(normalized);

  const upsert = db.prepare(`
    INSERT INTO products (item_key, name, code, package_code, barcode, qty_pcs, box_fill, qty_boxes, warehouse, image_url)
    VALUES (@item_key, @name, @code, @package_code, @barcode, @qty_pcs, @box_fill, @qty_boxes, @warehouse, @image_url)
    ON CONFLICT(item_key) DO UPDATE SET
      name=excluded.name,
      code=excluded.code,
      package_code=excluded.package_code,
      barcode=excluded.barcode,
      qty_pcs=excluded.qty_pcs,
      box_fill=excluded.box_fill,
      qty_boxes=excluded.qty_boxes,
      warehouse=excluded.warehouse,
      image_url=excluded.image_url
  `);
  upsert.run(normalized);
  return normalized;
}

function serveStaticFile(res, filePath, contentType) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

initializeDatabase();
cleanupMissingImageUrls();

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (pathname.startsWith('/api/products')) {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(listProducts()));
        return;
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const payload = body ? JSON.parse(body) : {};
            const product = payload.product || payload;
            const saved = upsertProduct(product);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(saved));
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: error.message }));
          }
        });
        return;
      }
    }

    if (pathname.startsWith('/images/')) {
      let imagePath = path.join(rootDir, pathname.replace(/^\//, ''));

      if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) {
        const ext = path.extname(imagePath);
        const basePath = ext ? imagePath.slice(0, -ext.length) : imagePath;
        const fallbackExts = ['.png', '.jpg', '.jpeg', '.webp'];

        for (const fExt of fallbackExts) {
          const altPath = basePath + fExt;
          if (fs.existsSync(altPath) && fs.statSync(altPath).isFile()) {
            imagePath = altPath;
            break;
          }
        }
      }

      if (fs.existsSync(imagePath) && fs.statSync(imagePath).isFile()) {
        serveStaticFile(res, imagePath, getContentType(imagePath));
        return;
      }
    }

    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(rootDir, requestedPath.replace(/^\//, ''));
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      serveStaticFile(res, filePath, getContentType(filePath));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(error.message);
  }
});

const requestedPort = Number(process.env.PORT || 3000);

function listen(port) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is busy, trying ${port + 1}...`);
      listen(port + 1);
      return;
    }
    throw error;
  });

  server.listen(port, () => {
    console.log(`Catalog server running at http://localhost:${port}`);
  });
}

listen(requestedPort);
