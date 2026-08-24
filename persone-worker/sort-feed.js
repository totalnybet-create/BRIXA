import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { createGzip } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('csv-parse');

const FEED_URL = process.env.ADMITAD_FEED_URL;
if (!FEED_URL) throw new Error('ADMITAD_FEED_URL missing');

const OUT = 'sorted-output';
const SHARD_SIZE = 50000;
const seen = new Set();
const states = new Map();
const rejectReasons = new Map();
let total = 0;
let valid = 0;
let duplicates = 0;
let rejected = 0;
let bytes = 0;
let nextProgress = 50000;

function inc(map, key) { map.set(key, (map.get(key) || 0) + 1); }
function normalizeUrl(value) { const s = String(value || '').trim(); return s.startsWith('//') ? `https:${s}` : s.startsWith('http://') ? `https://${s.slice(7)}` : s; }
function numeric(value) { const n = Number.parseFloat(String(value || '').replace(/[^0-9,.-]/g, '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : null; }
function affiliateOk(value) { try { const h = new URL(normalizeUrl(value)).hostname.toLowerCase(); return h === 'rzekl.com' || h.endsWith('.rzekl.com'); } catch { return false; } }
function headerKey(value) { return String(value || '').toLowerCase().replace(/^\ufeff/, '').replace(/[^a-z0-9]+/g, ''); }
function pick(keys, aliases) { const wanted = new Set(aliases.map(headerKey)); return keys.find(k => wanted.has(headerKey(k))) || null; }
function safeSlug(value) {
  const base = String(value || 'pozostale').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'pozostale';
  const hash = createHash('sha1').update(String(value || '')).digest('hex').slice(0, 8);
  return `${base}-${hash}`;
}

async function openShard(state) {
  state.shard += 1;
  state.inShard = 0;
  const filename = `part-${String(state.shard).padStart(3, '0')}.jsonl.gz`;
  const path = `${OUT}/${state.slug}/${filename}`;
  await mkdir(`${OUT}/${state.slug}`, { recursive: true });
  const gzip = createGzip({ level: 6 });
  const file = createWriteStream(path);
  gzip.pipe(file);
  state.gzip = gzip;
  state.file = file;
  state.parts.push({ file: filename, count: 0 });
}

async function closeShard(state) {
  if (!state.gzip) return;
  const gzip = state.gzip;
  const file = state.file;
  gzip.end();
  await once(file, 'close');
  state.gzip = null;
  state.file = null;
}

async function writeRecord(category, record) {
  let state = states.get(category);
  if (!state) {
    state = { category, slug: safeSlug(category), count: 0, shard: 0, inShard: 0, parts: [], gzip: null, file: null };
    states.set(category, state);
  }
  if (!state.gzip || state.inShard >= SHARD_SIZE) {
    if (state.gzip) await closeShard(state);
    await openShard(state);
  }
  const line = JSON.stringify(record) + '\n';
  if (!state.gzip.write(line)) await once(state.gzip, 'drain');
  state.count += 1;
  state.inShard += 1;
  state.parts[state.parts.length - 1].count += 1;
}

await mkdir(OUT, { recursive: true });
const res = await fetch(FEED_URL, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 PersoneSorter/1.0', Accept: 'text/csv,text/plain,*/*' } });
if (!res.ok || !res.body) throw new Error(`Feed HTTP ${res.status}`);

const reader = res.body.getReader();
async function* chunks() {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    yield Buffer.from(value);
  }
}

const parser = Readable.from(chunks()).pipe(parse({ columns: true, bom: true, delimiter: ';', skip_empty_lines: true, relax_quotes: true, relax_column_count: true }));
let map = null;

for await (const row of parser) {
  if (!map) {
    const keys = Object.keys(row);
    map = {
      id: pick(keys, ['id','product_id','productid','offer_id','offerid','item_id','itemid','sku']),
      name: pick(keys, ['name','product_name','productname','title']),
      url: pick(keys, ['tracking_url','trackingurl','affiliate_url','affiliateurl','url','deeplink','deep_link']),
      price: pick(keys, ['price','sale_price','saleprice','current_price','currentprice']),
      category: pick(keys, ['category_name','categoryname','category']),
      image: pick(keys, ['picture','picture_url','pictureurl','image','image_url','imageurl'])
    };
    const missing = ['id','name','url','price'].filter(k => !map[k]);
    if (missing.length) throw new Error(`Missing required CSV columns: ${missing.join(',')}`);
  }

  total += 1;
  const id = String(row[map.id] || '').trim();
  const title = String(row[map.name] || '').trim();
  const price = numeric(row[map.price]);
  const affiliate = row[map.url];
  const category = String(map.category ? row[map.category] || '' : '').trim() || 'Pozostałe';
  const image = normalizeUrl(map.image ? row[map.image] : '');

  let reason = '';
  if (!/^\d{5,32}$/.test(id)) reason = 'bad_id';
  else if (!title) reason = 'missing_title';
  else if (price === null) reason = 'bad_price';
  else if (!affiliateOk(affiliate)) reason = 'bad_affiliate_url';
  else if (!image) reason = 'missing_image';

  if (reason) {
    rejected += 1;
    inc(rejectReasons, reason);
  } else if (seen.has(id)) {
    duplicates += 1;
  } else {
    seen.add(id);
    valid += 1;
    await writeRecord(category, { ...row, _persone: { category, external_id: id } });
  }

  if (total >= nextProgress) {
    console.log(`SORT_PROGRESS total=${total} valid=${valid} duplicates=${duplicates} rejected=${rejected} categories=${states.size}`);
    nextProgress += 50000;
  }
}

for (const state of states.values()) await closeShard(state);

const categories = [...states.values()].sort((a,b) => b.count - a.count).map(s => ({ category: s.category, slug: s.slug, count: s.count, shards: s.parts }));
const rejects = [...rejectReasons.entries()].sort((a,b) => b[1] - a[1]).map(([reason,count]) => ({ reason, count }));
const manifest = { total_offers: total, unique_valid: valid, duplicates, rejected, bytes_read: bytes, categories_total: categories.length, shard_size: SHARD_SIZE, categories, rejects };
await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
await writeFile(`${OUT}/categories.csv`, 'category;count;slug;parts\n' + categories.map(x => `${JSON.stringify(x.category)};${x.count};${x.slug};${x.shards.length}`).join('\n') + '\n');
console.log(`SORT_DONE total=${total} unique_valid=${valid} duplicates=${duplicates} rejected=${rejected} categories=${categories.length}`);
