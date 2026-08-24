import { Readable } from 'node:stream';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse: csvParse } = require('csv-parse');
const FEED_URL = process.env.ADMITAD_FEED_URL;
const CHECKPOINT_PATH = '.affiliate-import-checkpoint.json';
if (!FEED_URL) throw new Error('Brak ADMITAD_FEED_URL');

const seen = new Set();
const categoryCounts = new Map();
let parsedCount = 0;
let validUniqueCount = 0;
let failedCount = 0;
let duplicateCount = 0;
let bytesRead = 0;

function normalizeUrl(value) {
  const s = String(value || '').trim();
  return s.startsWith('//') ? `https:${s}` : s.startsWith('http://') ? `https://${s.slice(7)}` : s;
}
function numeric(value) {
  const n = Number.parseFloat(String(value || '').replace(/[^0-9,.-]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function acceptableAffiliateUrl(value) {
  try {
    const h = new URL(value).hostname.toLowerCase();
    return h === 'rzekl.com' || h.endsWith('.rzekl.com');
  } catch {
    return false;
  }
}
function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/^\ufeff/, '').replace(/[^a-z0-9]+/g, '');
}
function chooseColumn(keys, aliases) {
  const wanted = new Set(aliases.map(normalizeHeader));
  return keys.find(k => wanted.has(normalizeHeader(k))) || null;
}
function csvMapping(row) {
  const keys = Object.keys(row);
  const map = {
    id: chooseColumn(keys, ['id','product_id','productid','offer_id','offerid','item_id','itemid','sku']),
    name: chooseColumn(keys, ['name','product_name','productname','title']),
    url: chooseColumn(keys, ['tracking_url','trackingurl','affiliate_url','affiliateurl','url','deeplink','deep_link']),
    price: chooseColumn(keys, ['price','sale_price','saleprice','current_price','currentprice']),
    category: chooseColumn(keys, ['category_name','categoryname','category'])
  };
  const missing = ['id','name','url','price'].filter(k => !map[k]);
  if (missing.length) throw new Error(`Brak kolumn: ${missing.join(', ')}`);
  console.log(`CENSUS mapping: ${Object.entries(map).filter(([,v])=>v).map(([k,v])=>`${k}=${v}`).join(', ')}`);
  return map;
}
async function saveCheckpoint(complete = false) {
  const categories = [...categoryCounts.entries()].sort((a,b) => b[1] - a[1]);
  await writeFile(CHECKPOINT_PATH, JSON.stringify({
    feed_census: true,
    parsed_count: parsedCount,
    valid_unique_count: validUniqueCount,
    failed_count: failedCount,
    duplicate_count: duplicateCount,
    category_count: categories.length,
    category_counts: categories,
    bytes_read: bytesRead,
    complete,
    updated_at: new Date().toISOString()
  }, null, 2), 'utf8');
}

const response = await fetch(FEED_URL, {
  headers: { 'User-Agent': 'Mozilla/5.0 PersoneStore-Census/1.0', Accept: 'text/csv,text/plain,*/*' },
  redirect: 'follow'
});
if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
if (!response.body) throw new Error('Feed bez strumienia');
console.log(`CENSUS START content-type=${response.headers.get('content-type') || 'unknown'}`);

async function* chunks() {
  const reader = response.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    bytesRead += value.byteLength;
    yield Buffer.from(value);
  }
}

const parser = Readable.from(chunks()).pipe(csvParse({
  columns: true,
  bom: true,
  delimiter: ';',
  skip_empty_lines: true,
  relax_quotes: true,
  relax_column_count: true,
  trim: false
}));
let map = null;
for await (const row of parser) {
  parsedCount++;
  if (!map) map = csvMapping(row);
  const id = String(row[map.id] || '').trim();
  const title = String(row[map.name] || '').trim();
  const price = numeric(row[map.price]);
  const affiliateUrl = normalizeUrl(row[map.url]);
  const category = String(map.category ? row[map.category] : 'Inne').trim() || 'Inne';
  if (!/^\d{5,32}$/.test(id) || !title || price === null || !acceptableAffiliateUrl(affiliateUrl)) {
    failedCount++;
  } else if (seen.has(id)) {
    duplicateCount++;
  } else {
    seen.add(id);
    validUniqueCount++;
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  }
  if (parsedCount % 100000 === 0) {
    console.log(`CENSUS ${parsedCount.toLocaleString('pl-PL')} | unique ${validUniqueCount.toLocaleString('pl-PL')} | failed ${failedCount.toLocaleString('pl-PL')} | dup ${duplicateCount.toLocaleString('pl-PL')}`);
    await saveCheckpoint(false);
  }
}
await saveCheckpoint(true);
console.log(`CENSUS DONE parsed=${parsedCount} unique=${validUniqueCount} failed=${failedCount} duplicates=${duplicateCount} categories=${categoryCounts.size}`);
