// Run the backend on your laptop: `node local-server.mjs` (reads .env if present).
// Same handler as AWS Lambda. Without AWS credentials, Bedrock falls back to rules.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { handler } = await import('./src/handler.mjs');
const port = Number(process.env.PORT || 8787);

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const url = new URL(req.url, `http://localhost:${port}`);
  const out = await handler({
    rawPath: url.pathname,
    requestContext: { http: { method: req.method } },
    headers: req.headers,
    queryStringParameters: Object.fromEntries(url.searchParams),
    body: chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined,
  });
  res.writeHead(out.statusCode, out.headers);
  res.end(out.body);
  console.log(`${req.method} ${url.pathname} -> ${out.statusCode}`);
}).listen(port, () => console.log(`One-Tilt backend on http://localhost:${port}  (paste this URL in the side panel)`));
