import fs from 'node:fs';
import { chromium } from 'playwright';

const target = process.env.TARGET_URL || 'https://g.co/gemini/share/d654b644704c';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 1200 },
  locale: 'pl-PL'
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
let status = {};
try {
  const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 90000 });
  status.httpStatus = response?.status() ?? null;
  await page.waitForTimeout(5000);
  const labels = [/zaakceptuj wszystko/i,/accept all/i,/zgadzam się/i,/i agree/i,/odrzuć wszystko/i,/reject all/i];
  for (const re of labels) {
    const btn = page.getByRole('button', { name: re }).first();
    if (await btn.isVisible().catch(() => false)) { await btn.click().catch(() => {}); await page.waitForTimeout(1500); break; }
  }
  for (let i=0;i<12;i++) { await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight*0.85,700))); await page.waitForTimeout(700); }
  await page.evaluate(() => window.scrollTo(0,0));
  await page.waitForTimeout(1200);
  const bodyText = await page.locator('body').innerText().catch(()=>'');
  const mainText = await page.locator('main').first().innerText().catch(()=>'');
  const roleMainText = await page.locator('[role="main"]').first().innerText().catch(()=>'');
  const best = [mainText,roleMainText,bodyText].sort((a,b)=>b.length-a.length)[0] || '';
  status.finalUrl = page.url(); status.title = await page.title(); status.bodyChars = bodyText.length; status.bestChars = best.length; status.timestamp = new Date().toISOString();
  fs.mkdirSync('artifacts',{recursive:true});
  fs.writeFileSync('artifacts/status.json',JSON.stringify(status,null,2));
  fs.writeFileSync('artifacts/page.txt',best);
  fs.writeFileSync('artifacts/body.txt',bodyText);
  fs.writeFileSync('artifacts/page.html',await page.content());
  await page.screenshot({path:'artifacts/page.png',fullPage:true});
  console.log(JSON.stringify(status,null,2));
  console.log('--- TEXT PREVIEW ---');
  console.log(best.slice(0,12000));
} catch (err) {
  status.error = String(err?.stack || err); status.finalUrl = page.url();
  fs.mkdirSync('artifacts',{recursive:true}); fs.writeFileSync('artifacts/status.json',JSON.stringify(status,null,2));
  await page.screenshot({path:'artifacts/error.png',fullPage:true}).catch(()=>{});
  console.error(status.error); process.exitCode=1;
} finally { await browser.close(); }
