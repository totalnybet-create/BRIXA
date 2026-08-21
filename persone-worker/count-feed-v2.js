import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';

const url = process.env.ADMITAD_FEED_URL;
if (!url) throw new Error('ADMITAD_FEED_URL missing');

const res = await fetch(url, { redirect: 'follow' });
if (!res.ok || !res.body) throw new Error(`Feed HTTP ${res.status}`);

const seen = new Set();
const categories = new Map();
const rejects = new Map();
let total = 0;
let valid = 0;
let duplicates = 0;
let rejected = 0;
let bytes = 0;
let nextProgress = 50000;

const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const normalizeUrl = v => { const s = String(v || '').trim(); return s.startsWith('//') ? `https:${s}` : s.startsWith('http://') ? `https://${s.slice(7)}` : s; };
const numeric = v => { const n = Number.parseFloat(String(v || '').replace(/[^0-9,.-]/g, '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : null; };
const affiliateOk = v => { try { const h = new URL(normalizeUrl(v)).hostname.toLowerCase(); return h === 'rzekl.com' || h.endsWith('.rzekl.com'); } catch { return false; } };
const key = v => String(v || '').toLowerCase().replace(/^\ufeff/, '').replace(/[^a-z0-9]+/g, '');
const pick = (keys, aliases) => { const wanted = new Set(aliases.map(key)); return keys.find(k => wanted.has(key(k))) || null; };

const reader = res.body.getReader();
async function* chunks() {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    yield Buffer.from(value);
  }
}

const parser = Readable.from(chunks()).pipe(parse({ delimiter: ';', columns: true, bom: true, relax_quotes: true, relax_column_count: true, skip_empty_lines: true }));
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

  total++;
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
    rejected++;
    inc(rejects, reason);
  } else if (seen.has(id)) {
    duplicates++;
  } else {
    seen.add(id);
    valid++;
    inc(categories, category);
  }

  if (total >= nextProgress) {
    console.log(`CENSUS_PROGRESS total=${total} valid=${valid} duplicates=${duplicates} rejected=${rejected}`);
    nextProgress += 50000;
  }
}

const categoryRows = [...categories.entries()].sort((a,b) => b[1] - a[1]);
const rejectRows = [...rejects.entries()].sort((a,b) => b[1] - a[1]);
let out = `TOTAL_OFFERS=${total}\nUNIQUE_VALID=${valid}\nDUPLICATES=${duplicates}\nREJECTED=${rejected}\nBYTES_READ=${bytes}\nCATEGORIES_TOTAL=${categoryRows.length}\n`;
out += rejectRows.map(([reason,count]) => `REJECT\t${count}\t${reason}`).join('\n') + (rejectRows.length ? '\n' : '');
out += categoryRows.map(([category,count]) => `CATEGORY\t${count}\t${category.replace(/[\r\n\t]+/g, ' ')}`).join('\n') + '\n';
await writeFile('feed-count.txt', out, 'utf8');
console.log(`CENSUS_DONE total=${total} unique_valid=${valid} duplicates=${duplicates} rejected=${rejected} categories=${categoryRows.length}`);
