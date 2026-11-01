// Read-only verification of one explicitly supplied, owned smoke-test session.
// Prints routing facts only; conversation content and credentials are never emitted.
import { readFile } from 'node:fs/promises';
import { zstdDecompressSync } from 'node:zlib';
const file = process.argv[2];
if (!file || !file.endsWith('.jsonl.zstd')) throw new Error('Supply the exact smoke-test .jsonl.zstd path');
const bytes = await readFile(file);
const chunks = [];
for (let offset = 0; offset < bytes.length;) {
  const { buffer, engine } = zstdDecompressSync(bytes.subarray(offset), { info: true });
  if (!Number.isSafeInteger(engine.bytesWritten) || engine.bytesWritten < 1) throw new Error('Zstandard decoder made no progress');
  chunks.push(buffer);
  offset += engine.bytesWritten;
}
const rows = Buffer.concat(chunks).toString('utf8').trim().split('\n').map(line => JSON.parse(line));
const boundary = rows.findLastIndex(row => row.type === 'session/end-seed');
const recent = rows.slice(Math.max(0, boundary + 1));
const routes = recent.filter(row => /^(model\/selection|request\/header)$/.test(row.type)).map(row => ({
  type: row.type, seq: row.seq,
  provider: row.data?.provider ?? row.data?.header?.config?.provider,
  model: row.data?.model ?? row.data?.header?.config?.model,
  reasoningEffort: row.data?.reasoningEffort ?? row.data?.header?.config?.reasoningEffort,
}));
const result = { sessionId: rows[0].id, origin: rows[0].origin, routes };
console.log(JSON.stringify(result, null, 2));
const selected = routes.findLast(row => row.type === 'model/selection');
if (!selected) throw new Error('No new model/selection event was recorded');
const requests = routes.filter(row => row.type === 'request/header' && row.seq > selected.seq);
if (!requests.length || requests.some(row => ['provider', 'model', 'reasoningEffort'].some(key => row[key] !== selected[key]))) throw new Error('Actual request route does not match the selected model');
