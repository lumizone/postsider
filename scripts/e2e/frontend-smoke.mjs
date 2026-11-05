// Local-only smoke: logs in at the dashboard, visits control-plane pages and
// reports console errors / failed requests. Needs a running stack and a local
// account. Usage: E2E_EMAIL=... E2E_PASSWORD=... node scripts/e2e/frontend-smoke.mjs
import { chromium } from 'playwright';

const BASE = process.env.E2E_FRONTEND ?? 'http://localhost:4200';
const EMAIL = process.env.E2E_EMAIL ?? 'e2e@local.test';
const PASSWORD = process.env.E2E_PASSWORD;
if (!PASSWORD) throw new Error('Set E2E_PASSWORD');
const PAGES = (process.env.E2E_PAGES ?? '/agents,/settings/policies,/settings/approval-flows,/settings/api,/settings/webhooks,/settings/mcp').split(',');

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const problems = [];
let current = 'login';
page.on('console', (m) => m.type() === 'error' && problems.push({ page: current, kind: 'console', text: m.text().slice(0, 300) }));
page.on('pageerror', (e) => problems.push({ page: current, kind: 'pageerror', text: String(e).slice(0, 300) }));
page.on('response', (r) => r.status() >= 400 && problems.push({ page: current, kind: 'http', text: `${r.status()} ${r.request().method()} ${r.url()}` }));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {});
console.log('after login:', page.url());

for (const p of PAGES) {
  current = p;
  const resp = await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle' }).catch((e) => ({ status: () => 'ERR ' + e.message }));
  await page.waitForTimeout(1500);
  const text = (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ').slice(0, 1500);
  console.log(`\n${p} -> status ${resp.status()} url ${page.url()}\n  text: ${text}`);
  await page.screenshot({ path: `/tmp/ps-e2e/w/shot${p.replace(/\//g, '_')}.png`, fullPage: false });
}
console.log('\nPROBLEMS', JSON.stringify(problems, null, 1));
await browser.close();
