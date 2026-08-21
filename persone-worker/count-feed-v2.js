import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
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
  const counts = [0, 0, 0];
  const patterns = [/<offer\b/gi, /<product\b/gi, /<item\b/gi];
  const add = (s) => patterns.forEach((re, i) => { const m = s.match(re); if (m) counts[i] += m.length; });
  let carry = '';
  let s = first.toString('utf8');
  carry = s.slice(-32);
  add(s.slice(0, -32));
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    s = carry + Buffer.from(value).toString('utf8');
    carry = s.slice(-32);
    add(s.slice(0, -32));
  }
  add(carry);
  count = Math.max(...counts);
} else {
  const stream = new Readable({
    async read() {
      try {
        const { value, done } = await reader.read();
        if (done) this.push(null); else this.push(Buffer.from(value));
      } catch (e) { this.destroy(e); }
    }
  });
  stream.unshift(first);
  const parser = parse({ delimiter: ';', columns: true, relax_quotes: true, relax_column_count: true, skip_empty_lines: true });
  stream.pipe(parser);
  for await (const _row of parser) count++;
}

console.log(`TOTAL_OFFERS=${count}`);
await writeFile('feed-count.txt', `TOTAL_OFFERS=${count}\n`, 'utf8');
