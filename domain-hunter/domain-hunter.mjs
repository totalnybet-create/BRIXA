import fs from 'node:fs';

const BASE = 'http://127.0.0.1:3000/api/tools';
const BRIEF = process.env.HUNT_BRIEF || 'international affiliate deal and product comparison marketplace; short memorable premium brand, easy to pronounce in Polish and English';
const MINUTES = Math.max(2, Number(process.env.HUNT_MINUTES || 120));
const MAX_UNIQUE = Math.max(200, Number(process.env.HUNT_MAX_UNIQUE || 2500));
const START = Date.now();
const DEADLINE = START + MINUTES * 60_000;

const angles = [
  'deal finder', 'price radar', 'smart shopping', 'best offers', 'global bargains',
  'shopping scout', 'deal hunt', 'price comparison', 'value discovery', 'offer radar',
  'save money', 'quick buy', 'market finder', 'product discovery', 'shopping intelligence',
  'best price', 'deal alert', 'buy smarter', 'marketplace', 'shopping search',
  'short premium invented brand', 'one word brand', 'fast memorable brand', 'global consumer brand'
];
const styles = ['brandable', 'short', 'creative', 'descriptive'];
const candidates = new Map();
const errors = [];
let iteration = 0;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function callTool(name, body, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE}/${name}`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { throw new Error(`non-JSON response: ${text.slice(0, 250)}`); }
      if (res.ok && json?.success) return json.data;
      const msg = json?.error?.message || `HTTP ${res.status}`;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(10_000 * attempt);
        continue;
      }
      throw new Error(msg);
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(5_000 * attempt);
    }
  }
}

function baseFromDomain(domain) {
  if (!domain) return '';
  return domain.toLowerCase().trim().replace(/^https?:\/\//, '').split('.')[0].replace(/[^a-z0-9-]/g, '');
}

function mergeSuggestion(item, style, angle) {
  const base = baseFromDomain(item.domain);
  if (!base || base.length < 3 || base.length > 14 || base.includes('--')) return;
  const prev = candidates.get(base) || {
    name: base,
    score: 0,
    hits: 0,
    styles: new Set(),
    angles: new Set(),
    com: null,
    pl: null,
    eu: null,
    source: item.source || null,
  };
  prev.score = Math.max(prev.score, Number(item.score || 0));
  prev.hits += 1;
  prev.styles.add(style);
  prev.angles.add(angle);
  if (String(item.domain).toLowerCase().endsWith('.com')) prev.com = Boolean(item.available);
  if (item.source) prev.source = item.source;
  candidates.set(base, prev);
}

function heuristicBonus(c) {
  let bonus = 0;
  const n = c.name;
  if (n.length >= 4 && n.length <= 8) bonus += 8;
  else if (n.length <= 10) bonus += 4;
  if (!/[0-9-]/.test(n)) bonus += 4;
  if (/^[a-z]+$/.test(n)) bonus += 2;
  bonus += Math.min(6, Math.max(0, c.hits - 1) * 2);
  if (c.com === true) bonus += 5;
  return bonus;
}

function rankBase() {
  return [...candidates.values()]
    .map(c => ({...c, composite: Math.min(100, Math.round((Number(c.score) || 0) + heuristicBonus(c))) }))
    .sort((a,b) => b.composite - a.composite || b.hits - a.hits || a.name.length - b.name.length);
}

async function generateRound() {
  const angle = angles[iteration % angles.length];
  const style = styles[iteration % styles.length];
  const query = `${BRIEF}; angle: ${angle}`.slice(0, 195);
  try {
    const data = await callTool('suggest_domains_smart', {
      query,
      tld: 'com',
      industry: 'ecommerce',
      style,
      max_suggestions: 12,
      include_premium: false,
    });
    const items = [
      ...(data?.results?.available || []),
      ...(data?.results?.premium || []),
    ];
    for (const item of items) mergeSuggestion(item, style, angle);
    console.log(`[round ${iteration + 1}] ${style}/${angle}: +${items.length}, unique=${candidates.size}`);
  } catch (err) {
    const msg = `[round ${iteration + 1}] ${err?.message || err}`;
    errors.push(msg);
    console.error(msg);
  }
  iteration += 1;
}

async function crossCheckTop(limit = 100) {
  const top = rankBase().slice(0, limit);
  for (let i = 0; i < top.length; i++) {
    const c = candidates.get(top[i].name);
    try {
      const data = await callTool('search_domain', {
        domain_name: c.name,
        tlds: ['com', 'pl', 'eu'],
      });
      for (const r of data?.results || []) {
        const tld = String(r.domain).split('.').pop();
        if (tld === 'com') c.com = Boolean(r.available);
        if (tld === 'pl') c.pl = Boolean(r.available);
        if (tld === 'eu') c.eu = Boolean(r.available);
      }
      if ((i + 1) % 10 === 0) console.log(`[cross-check] ${i + 1}/${top.length}`);
      await sleep(1200);
    } catch (err) {
      errors.push(`[cross-check ${c.name}] ${err?.message || err}`);
      await sleep(3000);
    }
  }
}

function verdict(score) {
  if (score >= 90) return 'wybitna';
  if (score >= 80) return 'bardzo mocna';
  if (score >= 70) return 'mocna';
  if (score >= 60) return 'średnia';
  return 'słaba';
}

function finalScore(c) {
  let s = c.composite;
  if (c.com === true && c.pl === true) s += 6;
  else if (c.com === true) s += 3;
  else if (c.pl === true) s += 2;
  if (c.eu === true) s += 1;
  if (c.com === false && c.pl === false) s -= 8;
  return Math.max(0, Math.min(100, Math.round(s)));
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
}

function writeReports() {
  const rows = rankBase().map(c => ({
    name: c.name,
    score: finalScore(c),
    verdict: verdict(finalScore(c)),
    com: c.com,
    pl: c.pl,
    eu: c.eu,
    hits: c.hits,
    source: c.source,
    styles: [...c.styles].join('|'),
    angles: [...c.angles].slice(0,5).join('|'),
  })).sort((a,b) => b.score - a.score || b.hits - a.hits || a.name.length - b.name.length);

  fs.mkdirSync('domain-hunter/results', {recursive:true});
  const payload = {
    brief: BRIEF,
    started_at: new Date(START).toISOString(),
    finished_at: new Date().toISOString(),
    requested_minutes: MINUTES,
    iterations: iteration,
    unique_candidates: candidates.size,
    errors,
    top: rows.slice(0, 250),
  };
  fs.writeFileSync('domain-hunter/results/results.json', JSON.stringify(payload, null, 2));

  const headers = ['rank','name','score','verdict','com','pl','eu','hits','source','styles'];
  const csv = [headers.join(',')];
  rows.slice(0,250).forEach((r, i) => csv.push([
    i+1,r.name,r.score,r.verdict,r.com,r.pl,r.eu,r.hits,r.source,r.styles
  ].map(csvEscape).join(',')));
  fs.writeFileSync('domain-hunter/results/results.csv', csv.join('\n'));

  const top20 = rows.slice(0,20);
  const md = [
    '# Domain Hunter AI — raport', '',
    `**Brief:** ${BRIEF}`,
    `**Iteracje:** ${iteration} · **unikalne kandydatury:** ${candidates.size} · **czas zadany:** ${MINUTES} min`, '',
    '| # | Nazwa | Wynik | Ocena | .com | .pl | .eu |',
    '|---:|---|---:|---|:---:|:---:|:---:|',
    ...top20.map((r,i) => `| ${i+1} | **${r.name}** | ${r.score}/100 | ${r.verdict} | ${r.com===true?'✅':r.com===false?'❌':'?'} | ${r.pl===true?'✅':r.pl===false?'❌':'?'} | ${r.eu===true?'✅':r.eu===false?'❌':'?'} |`),
    '', '## Wykres TOP 20', '',
    ...top20.map(r => `- ${r.name.padEnd(16)} ${'█'.repeat(Math.max(1, Math.round(r.score/5)))} ${r.score}`),
    '', `Błędy/ostrzeżenia: ${errors.length}`
  ].join('\n');
  fs.writeFileSync('domain-hunter/results/REPORT.md', md);

  const bars = top20.map((r,i) => `<div class="row"><span class="rank">${i+1}</span><strong>${r.name}</strong><div class="barwrap"><div class="bar" style="width:${r.score}%"></div></div><b>${r.score}</b><span>${r.com===true?'.com ✓':'.com ×'} ${r.pl===true?'.pl ✓':'.pl ×'} ${r.eu===true?'.eu ✓':'.eu ×'}</span></div>`).join('');
  const html = `<!doctype html><html lang="pl"><meta charset="utf-8"><title>Domain Hunter AI</title><style>body{font-family:system-ui;background:#111;color:#eee;margin:32px;max-width:1100px}.row{display:grid;grid-template-columns:34px 150px 1fr 48px 190px;gap:12px;align-items:center;margin:10px 0}.barwrap{height:18px;background:#2b2b2b;border-radius:8px;overflow:hidden}.bar{height:100%;background:linear-gradient(90deg,#999,#eee);border-radius:8px}.rank{opacity:.6}h1{margin-bottom:4px}.meta{opacity:.7;margin-bottom:28px}</style><h1>Domain Hunter AI — TOP 20</h1><div class="meta">${candidates.size} unikalnych nazw · ${iteration} iteracji · ${MINUTES} min</div>${bars}</html>`;
  fs.writeFileSync('domain-hunter/results/report.html', html);
}

console.log(`Domain Hunter start: ${MINUTES} min; target max unique=${MAX_UNIQUE}`);
while (Date.now() < DEADLINE && candidates.size < MAX_UNIQUE) {
  await generateRound();
  if (Date.now() + 65_000 >= DEADLINE) break;
  await sleep(60_000);
}

console.log(`Generation done: ${iteration} rounds, ${candidates.size} unique. Cross-checking TOP 100...`);
await crossCheckTop(Math.min(100, candidates.size));
writeReports();
console.log('Reports written to domain-hunter/results');
