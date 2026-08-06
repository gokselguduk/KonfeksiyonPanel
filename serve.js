const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const port = 8766;
http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/konfeksiyon-mobil.html';
  const f = path.join(root, p.replace(/^\//, ''));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404);
    return res.end('404 ' + p);
  }
  const ext = path.extname(f);
  const t = {
    '.html': 'text/html;charset=utf-8',
    '.js': 'application/javascript;charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
    '.css': 'text/css'
  }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': t, 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('Konfeksiyon panel: http://127.0.0.1:' + port + '/konfeksiyon-mobil.html'));
