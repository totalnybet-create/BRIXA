import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { parse } from 'csv-parse';

const url = process.env.ADMITAD_FEED_URL;
if (!url) throw new Error('ADMITAD_FEED_URL missing');

const res = await fetch(url, { redirect: 'follow' });
if (!res.ok || !res.body) throw new Error(`Feed HTTP ${res.status}`);

const contentType = res.headers.get('content-type') || '';
const reader = res.body.getReader();
let first = Buffer.alloc(0);
while (first.length < 65536) {
  const { value, done } = await reader.read();
  if (done) break;
  first = Buffer.concat([first, Buffer.from(value)]);
  if (first.includes(10)) break;
}
const head = first.toString('utf8', 0, Math.min(first.length, 4096)).trimStart();
const isXml = contentType.includes('xml') || head.startsWith('<');
let count = 0;

if (isXml) {
  let buf = first.toString('utf8');
  const patterns = [/<offer\b/gi, /<product\b/gi, /<item\b/gi];
  const counts = [0,0,0];
  const countChunk = (s) => patterns.forEach((re,i)=>{ const m=s.match(re); if(m) counts[i]+=m.length; });
  let carry = '';
  countChunk(buf);
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const s = carry + Buffer.from(value).toString('utf8');
    carry = s.slice(-32);
    countChunk(s.slice(0,-32));
  }
  countChunk(carry);
  count = Math.max(...counts);
} else {
  const { Readable } = await import('node:stream');
  const chunks = [first];
  const stream = new Readable({
    async read() {
      if (chunks.length) { this.push(chunks.shift()); return; }
      try {
        const { value, done } = await reader.read();
        if (done) this.push(null); else this.push(Buffer.from(value));
      } catch (e) { this.destroy(e); }
    }
  });
  const parser = parse({ delimiter: ';', columns: true, relax_quotes: true, relax_column_count: true, skip_empty_lines: true });
  stream.pipe(parser);
  for await (const _row of parser) count++;
}

console.log(`TOTAL_OFFERS=${count}`);
await Bun?.write?.('feed-count.txt', `TOTAL_OFFERS=${count}\n`).catch?.(()=>{});
