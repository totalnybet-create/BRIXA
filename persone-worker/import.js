import { createHash, createHmac } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);
const sax = require('sax');
const { parse: csvParse } = require('csv-parse');

const FEED_URL = secureFeedUrl(process.env.ADMITAD_FEED_URL);
const AUTH_URL = process.env.NEON_AUTH_URL || 'https://ep-autumn-math-auw5twqr.neonauth.c-10.us-east-1.aws.neon.tech/neondb/auth';
const DATA_URL = process.env.NEON_DATA_API_URL || 'https://ep-autumn-math-auw5twqr.apirest.c-10.us-east-1.aws.neon.tech/neondb/rest/v1';
const IMPORT_LIMIT = nonNegativeInteger(process.env.IMPORT_LIMIT, 0);
const CONFIGURED_RESUME_AFTER = nonNegativeInteger(process.env.RESUME_AFTER, 181000);
const BATCH_SIZE = positiveInteger(process.env.BATCH_SIZE, 1000);
const PROGRESS_EVERY = positiveInteger(process.env.PROGRESS_EVERY, 5000);
const CHECKPOINT_PATH = process.env.CHECKPOINT_PATH || '.affiliate-import-checkpoint.json';
const SOURCE = 'aliexpress';
const SOURCE_NAME = 'AliExpress WW affiliate feed';

if (!FEED_URL) throw new Error('Brak zmiennej ADMITAD_FEED_URL.');
if (BATCH_SIZE > 1000) throw new Error('BATCH_SIZE nie może przekraczać 1000.');

const signingKey = createHash('sha256').update(FEED_URL).digest();
const feedFingerprint = signingKey.toString('hex');
const categories = new Map();
const pending = [];
let resumeAfter = CONFIGURED_RESUME_AFTER;
let bytesRead = 0;
let parsedCount = 0;
let submittedCount = 0;
let failedCount = 0;
let nextProgress = Math.ceil((resumeAfter + 1) / PROGRESS_EVERY) * PROGRESS_EVERY;
let currentOffer = null;
let currentField = null;
let currentText = '';
let currentCategory = null;
let feedUpdatedAt = null;
let reachedLimit = false;
let authToken = null;

function positiveInteger(value, fallback) { const n = Number.parseInt(value || '', 10); return Number.isFinite(n) && n > 0 ? n : fallback; }
function nonNegativeInteger(value, fallback) { const n = Number.parseInt(value || '', 10); return Number.isFinite(n) && n >= 0 ? n : fallback; }
function secureFeedUrl(value) { if (!value) return value; const u = new URL(value); if (u.protocol === 'http:') u.protocol = 'https:'; if (u.protocol !== 'https:') throw new Error('Feed musi używać HTTPS.'); return u.toString(); }
function normalizeUrl(value) { const s = String(value || '').trim(); return s.startsWith('//') ? `https:${s}` : s.startsWith('http://') ? `https://${s.slice(7)}` : s; }
function validHttpUrl(value) { try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } }
function numeric(value) { const n = Number.parseFloat(String(value || '').replace(/[^0-9,.-]/g, '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : null; }
function discountPercent(raw, price, originalPrice) { const d = Number.parseInt(String(raw || '').replace(/[^0-9]/g, ''), 10); if (Number.isFinite(d)) return Math.max(0, Math.min(100, d)); return originalPrice && originalPrice > price ? Math.round((1 - price / originalPrice) * 100) : null; }
function asTimestamp(value) { if (!value) return null; const raw = value.trim(); const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T'); const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(normalized) ? normalized : `${normalized}Z`); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
function signature(externalId) { return createHmac('sha256', signingKey).update(externalId).digest('hex'); }
function attribute(node, name) { const wanted = name.toLowerCase(); for (const [key, raw] of Object.entries(node.attributes || {})) if (key.toLowerCase() === wanted) return String(raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw); return ''; }
function merchantUrlFromTracking(trackingUrl) { try { const tracking = new URL(trackingUrl); const ulp = tracking.searchParams.get('ulp'); if (!ulp) return null; const deepLink = new URL(ulp); return normalizeUrl(deepLink.searchParams.get('dl_target_url') || ulp); } catch { return null; } }
function acceptableAffiliateUrl(value) { try { const h = new URL(value).hostname.toLowerCase(); return h === 'rzekl.com' || h.endsWith('.rzekl.com'); } catch { return false; } }

function buildProduct(offer) {
  const externalId = String(offer.id || '').trim();
  const title = String(offer.name || '').trim().slice(0, 1200);
  const price = numeric(offer.price);
  const affiliateUrl = normalizeUrl(offer.url);
  if (!/^\d{5,32}$/.test(externalId) || !title || price === null || !acceptableAffiliateUrl(affiliateUrl)) return null;
  const originalPrice = numeric(offer.oldprice);
  const category = String(offer.categoryName || categories.get(String(offer.categoryId || '')) || offer.categoryId || 'Inne').trim();
  const imageUrl = normalizeUrl(offer.picture);
  const merchantUrl = merchantUrlFromTracking(affiliateUrl);
  if (merchantUrl && !merchantUrl.startsWith('https://www.aliexpress.com/')) return null;
  return {
    source: SOURCE, external_id: externalId, slug: `ae-${externalId}`, sku: externalId, brand: String(offer.brand || '').trim().slice(0, 250), title,
    description: String(offer.description || '').trim().slice(0, 10000), category, category_path: category ? [category] : [], price, original_price: originalPrice,
    currency: String(offer.currencyId || 'USD').trim().slice(0, 3).toUpperCase(), discount: discountPercent(offer.discount, price, originalPrice), sizes: [], tone: '',
    image_url: validHttpUrl(imageUrl) ? imageUrl : null, affiliate_url: affiliateUrl, merchant_url: merchantUrl, availability: 'in_stock', published: true,
    source_updated_at: feedUpdatedAt, raw: { feed_id: 14107, feed_name: SOURCE_NAME, feed_category_id: String(offer.categoryId || ''), commission_rate: String(offer.commissionRate || ''), ingest_sig: signature(externalId) }
  };
}

async function retry(operation, label, attempts = 5) { let lastError; for (let attempt = 1; attempt <= attempts; attempt++) { try { return await operation(); } catch (error) { lastError = error; if (attempt === attempts) break; const delay = 750 * 2 ** (attempt - 1); console.warn(`${label}: próba ${attempt}/${attempts} nieudana, ponawiam za ${delay} ms`); await new Promise(r => setTimeout(r, delay)); } } throw lastError; }
async function anonymousToken(force = false) { if (authToken && !force) return authToken; const r = await fetch(`${AUTH_URL}/token/anonymous`, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(`Neon Auth HTTP ${r.status}`); const b = await r.json(); if (!b.token) throw new Error('Neon Auth nie zwrócił tokenu.'); authToken = b.token; return authToken; }
async function postBatch(batch) {
  const send = async forceToken => { const token = await anonymousToken(forceToken); const r = await fetch(`${DATA_URL}/catalog_products?on_conflict=source%2Cexternal_id`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(batch) }); if ((r.status === 401 || r.status === 403) && !forceToken) return send(true); if (!r.ok) throw new Error(`Neon Data API HTTP ${r.status}: ${(await r.text()).slice(0, 500)}`); };
  await retry(() => send(false), 'batch_upsert'); submittedCount += batch.length; await saveCheckpoint();
}
async function loadCheckpoint() { try { const c = JSON.parse(await readFile(CHECKPOINT_PATH, 'utf8')); if (c.feed_fingerprint === feedFingerprint && Number.isInteger(c.parsed_count)) { resumeAfter = Math.max(resumeAfter, c.parsed_count); nextProgress = Math.ceil((resumeAfter + 1) / PROGRESS_EVERY) * PROGRESS_EVERY; } } catch (error) { if (error?.code !== 'ENOENT') console.warn(`Checkpoint pominięty: ${error.message}`); } }
async function saveCheckpoint() { const temp = `${CHECKPOINT_PATH}.tmp`; const body = JSON.stringify({ feed_id: 14107, feed_fingerprint: feedFingerprint, parsed_count: parsedCount, submitted_count: submittedCount, failed_count: failedCount, bytes_read: bytesRead, updated_at: new Date().toISOString(), complete: reachedLimit }); await writeFile(temp, body, { mode: 0o600 }); await rename(temp, CHECKPOINT_PATH); }
async function flushPending(force = false) { while (pending.length >= BATCH_SIZE || (force && pending.length)) { const batch = pending.splice(0, BATCH_SIZE); await postBatch(batch); } }
function progress() { while (parsedCount >= nextProgress) { console.log(`Importowano ${nextProgress.toLocaleString('pl-PL')} / 2M`); nextProgress += PROGRESS_EVERY; } }
function acceptOffer(offer) { parsedCount++; if (parsedCount > resumeAfter) { const product = buildProduct(offer); if (product) pending.push(product); else failedCount++; } if (IMPORT_LIMIT > 0 && parsedCount >= IMPORT_LIMIT) reachedLimit = true; }

function createXmlParser() {
  const parser = sax.parser(true, { trim: false, normalize: false });
  parser.onopentag = node => { if (reachedLimit) return; const name = node.name.toLowerCase(); if (name === 'yml_catalog') feedUpdatedAt = asTimestamp(attribute(node, 'date')); if (name === 'offer') { currentOffer = { id: attribute(node, 'id') }; currentField = null; currentText = ''; return; } if (!currentOffer && name === 'category') { currentCategory = { id: attribute(node, 'id'), text: '' }; return; } if (!currentOffer) return; const fields = new Map([['name','name'],['url','url'],['price','price'],['oldprice','oldprice'],['currencyid','currencyId'],['categoryid','categoryId'],['picture','picture'],['description','description'],['vendor','brand'],['param','param']]); currentField = fields.get(name) || null; currentText = ''; if (currentField === 'param') currentOffer.paramName = attribute(node, 'name').toLowerCase(); };
  parser.ontext = text => { if (reachedLimit) return; if (currentCategory && !currentOffer) currentCategory.text += text; if (currentOffer && currentField) currentText += text; };
  parser.oncdata = parser.ontext;
  parser.onclosetag = rawName => { if (reachedLimit) return; const name = rawName.toLowerCase(); if (!currentOffer && currentCategory && name === 'category') { if (currentCategory.id) categories.set(currentCategory.id, currentCategory.text.trim()); currentCategory = null; return; } if (!currentOffer) return; if (currentField && ((currentField === 'param' && name === 'param') || currentField.toLowerCase() === name)) { const text = currentText.trim(); if (currentField === 'picture') { if (!currentOffer.picture) currentOffer.picture = text; } else if (currentField === 'param') { if (currentOffer.paramName === 'discount') currentOffer.discount = text; if (currentOffer.paramName === 'commissionrate') currentOffer.commissionRate = text; } else currentOffer[currentField] = text; currentField = null; currentText = ''; } if (name === 'offer') { acceptOffer(currentOffer); currentOffer = null; currentField = null; currentText = ''; } };
  parser.onerror = error => { throw error; };
  return parser;
}

function normalizeHeader(value) { return String(value || '').toLowerCase().replace(/^\ufeff/, '').replace(/[^a-z0-9]+/g, ''); }
function chooseColumn(keys, aliases) { const wanted = new Set(aliases.map(normalizeHeader)); return keys.find(k => wanted.has(normalizeHeader(k))) || null; }
function csvMapping(row) {
  const keys = Object.keys(row);
  const map = {
    id: chooseColumn(keys, ['id','product_id','productid','offer_id','offerid','item_id','itemid','sku']),
    name: chooseColumn(keys, ['name','product_name','productname','title']),
    url: chooseColumn(keys, ['tracking_url','trackingurl','affiliate_url','affiliateurl','url','deeplink','deep_link']),
    price: chooseColumn(keys, ['price','sale_price','saleprice','current_price','currentprice']),
    oldprice: chooseColumn(keys, ['oldprice','old_price','original_price','originalprice']),
    currencyId: chooseColumn(keys, ['currency','currency_id','currencyid']),
    categoryId: chooseColumn(keys, ['category_id','categoryid']),
    categoryName: chooseColumn(keys, ['category_name','categoryname','category']),
    picture: chooseColumn(keys, ['picture','picture_url','pictureurl','image','image_url','imageurl']),
    discount: chooseColumn(keys, ['discount','discount_percent','discountpercent']),
    commissionRate: chooseColumn(keys, ['commission_rate','commissionrate']),
    description: chooseColumn(keys, ['description','product_description','productdescription']),
    brand: chooseColumn(keys, ['brand','vendor'])
  };
  const missing = ['id','name','url','price'].filter(k => !map[k]);
  if (missing.length) throw new Error(`CSV nie ma wymaganych kolumn ${missing.join(', ')}. Wykryto: ${keys.slice(0, 40).join(' | ')}`);
  console.log(`CSV mapping: ${Object.entries(map).filter(([,v]) => v).map(([k,v]) => `${k}=${v}`).join(', ')}`);
  return map;
}
function csvOffer(row, map) { const offer = {}; for (const [field, key] of Object.entries(map)) if (key) offer[field] = row[key]; return offer; }
function guessDelimiter(line) { const candidates = [',',';','\t']; let best = ',', bestCount = -1; for (const d of candidates) { const count = line.split(d).length - 1; if (count > bestCount) { best = d; bestCount = count; } } return best; }

async function parseXml(reader, firstChunk) {
  const decoder = new TextDecoder(); const parser = createXmlParser(); parser.write(decoder.decode(firstChunk, { stream: true })); await flushPending(false); progress();
  while (!reachedLimit) { const { done, value } = await reader.read(); if (done) { parser.write(decoder.decode()).close(); reachedLimit = true; break; } bytesRead += value.byteLength; parser.write(decoder.decode(value, { stream: true })); await flushPending(false); progress(); }
}
async function parseCsv(reader, firstChunk, probe) {
  const firstLine = probe.replace(/^\ufeff/, '').split(/\r?\n/, 1)[0]; const delimiter = guessDelimiter(firstLine); console.log(`CSV delimiter: ${delimiter === '\t' ? 'TAB' : delimiter}`);
  async function* chunks() { yield Buffer.from(firstChunk); while (!reachedLimit) { const { done, value } = await reader.read(); if (done) break; bytesRead += value.byteLength; yield Buffer.from(value); } }
  const parser = Readable.from(chunks()).pipe(csvParse({ columns: true, bom: true, delimiter, skip_empty_lines: true, relax_quotes: true, relax_column_count: true, trim: false }));
  let map = null;
  for await (const row of parser) { if (!map) map = csvMapping(row); acceptOffer(csvOffer(row, map)); if (pending.length >= BATCH_SIZE) await flushPending(false); progress(); if (reachedLimit) { parser.destroy(); break; } }
  reachedLimit = true;
}

async function main() {
  await loadCheckpoint(); const target = IMPORT_LIMIT > 0 ? IMPORT_LIMIT.toLocaleString('pl-PL') : 'koniec feedu';
  console.log(`Start: wznowienie po ${resumeAfter.toLocaleString('pl-PL')}, cel ${target}, batch ${BATCH_SIZE}.`); console.log(`Feed fingerprint: ${feedFingerprint}`); await anonymousToken();
  const response = await fetch(FEED_URL, { headers: { 'User-Agent': 'Mozilla/5.0 PersoneStore/4.0', Accept: 'application/xml,text/xml,text/csv,text/plain,*/*' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`Feed blocked: HTTP ${response.status}`); if (!response.body) throw new Error('Feed nie udostępnił strumienia danych.');
  const reader = response.body.getReader(); const first = await reader.read(); if (first.done || !first.value?.length) throw new Error('Feed jest pusty.'); bytesRead += first.value.byteLength;
  const probe = new TextDecoder().decode(first.value.slice(0, Math.min(first.value.byteLength, 65536))); const clean = probe.replace(/^\ufeff/, '').trimStart(); const format = clean.startsWith('<') ? 'xml' : 'csv';
  console.log(`Feed format: ${format}; content-type: ${response.headers.get('content-type') || 'unknown'}; first-token: ${JSON.stringify(clean.slice(0, 24).replace(/[^\x20-\x7e]/g, '?'))}`);
  if (format === 'xml') await parseXml(reader, first.value); else await parseCsv(reader, first.value, probe);
  if (IMPORT_LIMIT > 0 && parsedCount >= IMPORT_LIMIT) try { await reader.cancel('Osiągnięto końcowy limit importu.'); } catch {}
  await flushPending(true); await saveCheckpoint(); console.log(`Gotowe: odczytano ${parsedCount.toLocaleString('pl-PL')}, wysłano ${submittedCount.toLocaleString('pl-PL')}, odrzucono ${failedCount.toLocaleString('pl-PL')}.`);
}
main().catch(async error => { console.error('IMPORT FAILED:', error instanceof Error ? error.message : String(error)); try { await saveCheckpoint(); } catch {} process.exitCode = 1; });
