import { createHash, createHmac } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sax = require('sax');

const FEED_URL = secureFeedUrl(process.env.ADMITAD_FEED_URL);
const AUTH_URL = process.env.NEON_AUTH_URL || 'https://ep-autumn-math-auw5twqr.neonauth.c-10.us-east-1.aws.neon.tech/neondb/auth';
const DATA_URL = process.env.NEON_DATA_API_URL || 'https://ep-autumn-math-auw5twqr.apirest.c-10.us-east-1.aws.neon.tech/neondb/rest/v1';
const IMPORT_LIMIT = nonNegativeInteger(process.env.IMPORT_LIMIT, 0);
const CONFIGURED_RESUME_AFTER = nonNegativeInteger(process.env.RESUME_AFTER, 181000);
const BATCH_SIZE = positiveInteger(process.env.BATCH_SIZE, 1000);
const PROGRESS_EVERY = positiveInteger(process.env.PROGRESS_EVERY, 5000);
const CHECKPOINT_PATH = process.env.CHECKPOINT_PATH || '.affiliate-import-checkpoint.json';
const SOURCE = 'aliexpress';
const SOURCE_NAME = 'AliExpress WW feed 14107';

if (!FEED_URL) throw new Error('Brak zmiennej ADMITAD_FEED_URL.');
if (BATCH_SIZE > 1000) throw new Error('BATCH_SIZE nie może przekraczać 1000.');

const signingKey = createHash('sha256').update(FEED_URL).digest();
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

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function nonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
function secureFeedUrl(value) {
  if (!value) return value;
  const url = new URL(value);
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') throw new Error('Feed musi używać HTTPS.');
  return url.toString();
}
function attribute(node, name) {
  const wanted = name.toLowerCase();
  for (const [key, raw] of Object.entries(node.attributes || {})) {
    if (key.toLowerCase() !== wanted) continue;
    return String(raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw);
  }
  return '';
}
function normalizeUrl(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('http://')) return `https://${trimmed.slice(7)}`;
  return trimmed;
}
function validHttpUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; } catch { return false; }
}
function merchantUrlFromTracking(trackingUrl) {
  try {
    const tracking = new URL(trackingUrl);
    const ulp = tracking.searchParams.get('ulp');
    if (!ulp) return null;
    const deepLink = new URL(ulp);
    return normalizeUrl(deepLink.searchParams.get('dl_target_url') || ulp);
  } catch { return null; }
}
function numeric(value) {
  const parsed = Number.parseFloat(String(value || '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function discountPercent(raw, price, originalPrice) {
  const direct = Number.parseInt(String(raw || '').replace(/[^0-9]/g, ''), 10);
  if (Number.isFinite(direct)) return Math.max(0, Math.min(100, direct));
  if (originalPrice && originalPrice > price) return Math.round((1 - price / originalPrice) * 100);
  return null;
}
function asTimestamp(value) {
  if (!value) return null;
  const normalized = `${value.trim().replace(' ', 'T')}${value.includes('Z') ? '' : ':00Z'}`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function signature(externalId) { return createHmac('sha256', signingKey).update(externalId).digest('hex'); }
function buildProduct(offer) {
  const externalId = String(offer.id || '').trim();
  const title = String(offer.name || '').trim().slice(0, 1200);
  const price = numeric(offer.price);
  const affiliateUrl = normalizeUrl(offer.url);
  if (!/^\d{5,32}$/.test(externalId) || !title || price === null || !affiliateUrl.startsWith('https://rzekl.com/')) return null;
  const originalPrice = numeric(offer.oldprice);
  const category = categories.get(String(offer.categoryId || '')) || String(offer.categoryId || 'Inne');
  const imageUrl = normalizeUrl(offer.picture);
  const merchantUrl = merchantUrlFromTracking(affiliateUrl);
  if (merchantUrl && !merchantUrl.startsWith('https://www.aliexpress.com/')) return null;
  return {
    source: SOURCE, external_id: externalId, slug: `ae-${externalId}`, sku: externalId, brand: '', title, description: '',
    category, category_path: category ? [category] : [], price, original_price: originalPrice,
    currency: String(offer.currencyId || 'USD').trim().slice(0,3).toUpperCase(),
    discount: discountPercent(offer.discount, price, originalPrice), sizes: [], tone: '',
    image_url: validHttpUrl(imageUrl) ? imageUrl : null, affiliate_url: affiliateUrl, merchant_url: merchantUrl,
    availability: 'in_stock', published: true, source_updated_at: feedUpdatedAt,
    raw: { feed_id: 14107, feed_name: SOURCE_NAME, feed_category_id: String(offer.categoryId || ''), commission_rate: String(offer.commissionRate || ''), ingest_sig: signature(externalId) },
  };
}
async function retry(operation, label, attempts=5) {
  let lastError;
  for (let attempt=1; attempt<=attempts; attempt+=1) {
    try { return await operation(); } catch (error) {
      lastError=error; if (attempt===attempts) break;
      const delay=750*2**(attempt-1); console.warn(`${label}: próba ${attempt}/${attempts} nieudana, ponawiam za ${delay} ms`);
      await new Promise(resolve=>setTimeout(resolve,delay));
    }
  }
  throw lastError;
}
async function anonymousToken(force=false) {
  if (authToken && !force) return authToken;
  const response=await fetch(`${AUTH_URL}/token/anonymous`,{headers:{Accept:'application/json'}});
  if (!response.ok) throw new Error(`Neon Auth HTTP ${response.status}`);
  const body=await response.json(); if (!body.token) throw new Error('Neon Auth nie zwrócił tokenu.');
  authToken=body.token; return authToken;
}
async function postBatch(batch) {
  const send=async forceToken=>{
    const token=await anonymousToken(forceToken);
    const response=await fetch(`${DATA_URL}/catalog_products?on_conflict=source%2Cexternal_id`,{
      method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify(batch)
    });
    if ((response.status===401||response.status===403)&&!forceToken) return send(true);
    if (!response.ok) throw new Error(`Neon Data API HTTP ${response.status}: ${(await response.text()).slice(0,500)}`);
  };
  await retry(()=>send(false),'batch_upsert'); submittedCount+=batch.length; await saveCheckpoint();
}
async function loadCheckpoint() {
  try {
    const checkpoint=JSON.parse(await readFile(CHECKPOINT_PATH,'utf8'));
    if (checkpoint.feed_id===14107&&Number.isInteger(checkpoint.parsed_count)) {
      resumeAfter=Math.max(resumeAfter,checkpoint.parsed_count);
      nextProgress=Math.ceil((resumeAfter+1)/PROGRESS_EVERY)*PROGRESS_EVERY;
    }
  } catch(error) { if(error?.code!=='ENOENT') console.warn(`Checkpoint pominięty: ${error.message}`); }
}
async function saveCheckpoint() {
  const temporary=`${CHECKPOINT_PATH}.tmp`;
  const body=JSON.stringify({feed_id:14107,parsed_count:parsedCount,submitted_count:submittedCount,failed_count:failedCount,bytes_read:bytesRead,updated_at:new Date().toISOString(),complete:reachedLimit});
  await writeFile(temporary,body,{mode:0o600}); await rename(temporary,CHECKPOINT_PATH);
}
async function flushPending(force=false) {
  while(pending.length>=BATCH_SIZE||(force&&pending.length)){const batch=pending.splice(0,BATCH_SIZE);await postBatch(batch);}
}
function assignField(offer,field,value,paramName){
  const text=value.trim(); if(!text)return;
  if(field==='picture'){if(!offer.picture)offer.picture=text;return;}
  if(field==='param'){if(paramName==='discount')offer.discount=text;if(paramName==='commissionrate')offer.commissionRate=text;return;}
  offer[field]=text;
}
function createParser(){
  const parser=sax.parser(true,{trim:false,normalize:false});
  parser.onopentag=node=>{
    if(reachedLimit)return; const name=node.name.toLowerCase();
    if(name==='yml_catalog')feedUpdatedAt=asTimestamp(attribute(node,'date'));
    if(name==='offer'){currentOffer={id:attribute(node,'id')};currentField=null;currentText='';return;}
    if(!currentOffer&&name==='category'){currentCategory={id:attribute(node,'id'),text:''};return;}
    if(!currentOffer)return;
    const fields=new Map([['name','name'],['url','url'],['price','price'],['oldprice','oldprice'],['currencyid','currencyId'],['categoryid','categoryId'],['picture','picture'],['param','param']]);
    currentField=fields.get(name)||null;currentText='';if(currentField==='param')currentOffer.paramName=attribute(node,'name').toLowerCase();
  };
  parser.ontext=text=>{if(reachedLimit)return;if(currentCategory&&!currentOffer)currentCategory.text+=text;if(currentOffer&&currentField)currentText+=text;};
  parser.oncdata=parser.ontext;
  parser.onclosetag=rawName=>{
    if(reachedLimit)return;const name=rawName.toLowerCase();
    if(!currentOffer&&currentCategory&&name==='category'){if(currentCategory.id)categories.set(currentCategory.id,currentCategory.text.trim());currentCategory=null;return;}
    if(!currentOffer)return;
    if(currentField&&((currentField==='param'&&name==='param')||currentField.toLowerCase()===name)){assignField(currentOffer,currentField,currentText,currentOffer.paramName);currentField=null;currentText='';}
    if(name!=='offer')return;
    parsedCount+=1;
    if(parsedCount>resumeAfter){const product=buildProduct(currentOffer);if(product)pending.push(product);else failedCount+=1;}
    currentOffer=null;currentField=null;currentText='';if(IMPORT_LIMIT>0&&parsedCount>=IMPORT_LIMIT)reachedLimit=true;
  };
  parser.onerror=error=>{throw error;}; return parser;
}
async function main(){
  await loadCheckpoint();const target=IMPORT_LIMIT>0?IMPORT_LIMIT.toLocaleString('pl-PL'):'koniec feedu';
  console.log(`Start: wznowienie po ${resumeAfter.toLocaleString('pl-PL')}, cel ${target}, batch ${BATCH_SIZE}.`);await anonymousToken();
  const response=await fetch(FEED_URL,{headers:{'User-Agent':'Mozilla/5.0 PersoneStore/3.0',Accept:'application/xml,text/xml'},redirect:'follow'});
  if(!response.ok)throw new Error(`Feed blocked: ${response.status}`);if(!response.body)throw new Error('Feed nie udostępnił strumienia danych.');
  const reader=response.body.getReader();const decoder=new TextDecoder();const parser=createParser();
  while(!reachedLimit){
    const {done,value}=await reader.read();
    if(done){parser.write(decoder.decode()).close();reachedLimit=true;break;}
    bytesRead+=value.byteLength;parser.write(decoder.decode(value,{stream:true}));await flushPending(false);
    while(parsedCount>=nextProgress){console.log(`Importowano ${nextProgress.toLocaleString('pl-PL')} / 2M`);nextProgress+=PROGRESS_EVERY;}
  }
  if(IMPORT_LIMIT>0&&parsedCount>=IMPORT_LIMIT)await reader.cancel('Osiągnięto końcowy limit importu.');
  await flushPending(true);await saveCheckpoint();console.log(`Gotowe: odczytano ${parsedCount.toLocaleString('pl-PL')}, wysłano ${submittedCount.toLocaleString('pl-PL')}, błędy ${failedCount.toLocaleString('pl-PL')}.`);
}
main().catch(async error=>{console.error('IMPORT FAILED:',error instanceof Error?error.message:String(error));try{await saveCheckpoint();}catch{}process.exitCode=1;});
