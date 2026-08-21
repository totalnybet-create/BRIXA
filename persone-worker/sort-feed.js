import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';

const FEED_URL = process.env.ADMITAD_FEED_URL;
const OUT = process.env.OUT_DIR || 'sorted-output';
const PROGRESS_EVERY = Number(process.env.PROGRESS_EVERY || 100000);
if (!FEED_URL) throw new Error('ADMITAD_FEED_URL missing');

const clean = v => String(v ?? '').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const num = v => { const n = Number.parseFloat(String(v ?? '').replace(/[^0-9,.-]/g,'').replace(',','.')); return Number.isFinite(n) && n >= 0 ? n : null; };
const slug = v => clean(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120) || 'inne';
const validAffiliate = v => { try { const h = new URL(v).hostname.toLowerCase(); return h === 'rzekl.com' || h.endsWith('.rzekl.com'); } catch { return false; } };
const normalizeUrl = v => { const s = clean(v); return s.startsWith('//') ? `https:${s}` : s.startsWith('http://') ? `https://${s.slice(7)}` : s; };
const header = ['category_slug','category','id','title','price','old_price','currency','image_url','affiliate_url'];

await mkdir(OUT, { recursive: true });
const tsvPath = `${OUT}/all-products.tsv`;
const ws = createWriteStream(tsvPath, { encoding: 'utf8' });
ws.write(header.join('\t') + '\n');
const categories = new Map();
const ids = new Set();
let parsed = 0, accepted = 0, rejected = 0, duplicates = 0;

const res = await fetch(FEED_URL, { redirect: 'follow' });
if (!res.ok || !res.body) throw new Error(`Feed HTTP ${res.status}`);
const reader = res.body.getReader();
async function* chunks() {
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    yield Buffer.from(value);
  }
}
const parser = Readable.from(chunks()).pipe(parse({ columns: true, bom: true, delimiter: ';', skip_empty_lines: true, relax_quotes: true, relax_column_count: true }));
for await (const row of parser) {
  parsed++;
  const id = clean(row.id);
  const title = clean(row.name || row.title);
  const price = num(row.price);
  const affiliate = normalizeUrl(row.url || row.affiliate_url);
  const category = clean(row.category || row.categoryName || 'Inne') || 'Inne';
  if (!/^\d{5,32}$/.test(id) || !title || price === null || !validAffiliate(affiliate)) { rejected++; continue; }
  if (ids.has(id)) { duplicates++; continue; }
  ids.add(id);
  const cslug = slug(category);
  categories.set(category, (categories.get(category) || 0) + 1);
  const values = [cslug, category, id, title.slice(0,1200), price, num(row.oldprice) ?? '', clean(row.currencyId || row.currency || 'USD').slice(0,3).toUpperCase(), normalizeUrl(row.picture || row.image_url), affiliate];
  if (!ws.write(values.map(clean).join('\t') + '\n')) await once(ws, 'drain');
  accepted++;
  if (parsed % PROGRESS_EVERY === 0) console.log(`Przetworzono ${parsed.toLocaleString('pl-PL')} | przyjęto ${accepted.toLocaleString('pl-PL')} | odrzucono ${rejected.toLocaleString('pl-PL')} | duplikaty ${duplicates.toLocaleString('pl-PL')}`);
}
ws.end();
await once(ws, 'finish');

const cats = [...categories.entries()].sort((a,b)=>b[1]-a[1]);
await writeFile(`${OUT}/category-counts.csv`, 'category,count\n' + cats.map(([c,n]) => `"${c.replaceAll('"','""')}",${n}`).join('\n') + '\n');
await writeFile(`${OUT}/summary.json`, JSON.stringify({ parsed, accepted, rejected, duplicates, categories: cats.length, completed_at: new Date().toISOString() }, null, 2));
console.log(`DONE parsed=${parsed} accepted=${accepted} rejected=${rejected} duplicates=${duplicates} categories=${cats.length}`);
