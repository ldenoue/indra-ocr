import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const port = Number(process.env.PORT || 8767);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.onnx': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'tests/browser/index.html' : pathname.slice(1);
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) throw new Error('invalid path');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Content-Length': info.size,
      // Enables SharedArrayBuffer and multithreaded ORT WASM.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': file.endsWith('.onnx') ? 'public, max-age=3600' : 'no-cache',
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Indra browser test: http://127.0.0.1:${port}/`);
});
