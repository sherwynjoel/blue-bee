/* eslint-disable no-console */
/**
 * Real-browser screenshots of the facility-linen console (light + dark) via puppeteer-core + system
 * Chrome. Logs in ONCE as the OWNER (ops), injects the refresh token so the app hydrates the real
 * session, selects the seeded Maple Grove care home + West Wing, and captures: the pack-to-par load
 * sheet, par management (with the set-par form), and the soiled-cart pickup record (with the form).
 *
 * Prereq: API at API_BASE (CORS_ALLOWED_ORIGINS includes WEB_BASE, SMS_TRANSPORT=console) + web built &
 * served at WEB_BASE + seed applied. Run: node apps/web/scripts/facility-linen-screenshots.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000';
const WEB_BASE = process.env.WEB_BASE ?? 'http://localhost:3001';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT_DIR = process.env.OUT_DIR ?? '/Volumes/Gowtham/Blue Bee/Projects/Blue Bee/screenshots/web-console/facility-linen';
const PHONE = process.env.OWNER_PHONE ?? '+14165550001';

async function api(method, path, body, token) {
  const res = await fetch(`${API_BASE}/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}
async function login(phone) {
  const otp = await api('POST', '/auth/otp', { phone });
  if (!otp.devCode) throw new Error('no devCode (SMS_TRANSPORT=console?)');
  return api('POST', '/auth/verify', { phone, code: otp.devCode });
}
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`▶ Facility-linen screenshots → ${OUT_DIR}`);
  const { accessToken, refreshToken } = await login(PHONE);

  // Resolve the seeded Maple Grove account + West Wing site (so the seeded par/on-hand/pickup data shows).
  const accounts = await api('GET', '/accounts?limit=100', undefined, accessToken);
  const acct = accounts.accounts.find((a) => /Maple Grove/i.test(a.name));
  if (!acct) throw new Error('Maple Grove account not found — seed applied?');
  const detail = await api('GET', `/accounts/${acct.id}`, undefined, accessToken);
  const site = detail.sites.find((s) => /West Wing/i.test(s.name)) ?? detail.sites[0];
  console.log(`  account=${acct.name} (${acct.id}) site=${site.name} (${site.id})`);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1380, height: 1200, deviceScaleFactor: 2 });
  await page.goto(WEB_BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((rt) => localStorage.setItem('bb.console.refresh', rt), refreshToken);

  const shot = async (name) => {
    await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true });
    console.log(`  ✓ ${name}.png`);
  };
  const selectValue = async (ariaLabel, value) => {
    await page.evaluate((al, v) => {
      const sel = document.querySelector(`select[aria-label="${al}"]`);
      if (!sel) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, v);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, ariaLabel, value);
  };
  const clickTestId = async (id) => {
    await page.evaluate((t) => {
      const el = document.querySelector(`[data-testid="${t}"]`);
      if (el) el.click();
    }, id);
  };

  const captureFor = async (theme) => {
    await page.evaluate((th) => localStorage.setItem('bb-theme', th), theme);
    await page.goto(`${WEB_BASE}/facility-linen`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('select[aria-label="Account"]', { timeout: 25000 });
    await selectValue('Account', acct.id);
    // Wait for the site select to populate with the chosen account's sites, then pick West Wing.
    await page.waitForFunction((sid) => {
      const sel = document.querySelector('select[aria-label="Site"]');
      return sel && [...sel.options].some((o) => o.value === sid);
    }, { timeout: 25000 }, site.id);
    await selectValue('Site', site.id);
    // Wait for the pack-to-par table (the seeded gaps) to render.
    await page.waitForSelector('[data-testid="ptp-total"]', { timeout: 25000 });
    await settle();
    await shot(`pack-to-par-${theme}`);

    // Par management — open the set-par form.
    await clickTestId('par-new');
    await settle(400);
    await shot(`par-management-${theme}`);
    await clickTestId('par-new'); // close

    // Soiled-cart pickup — open the record form.
    await clickTestId('pickup-new');
    await settle(400);
    await shot(`soil-pickup-${theme}`);
    await clickTestId('pickup-new'); // close
  };

  try {
    await captureFor('light');
    await captureFor('dark');
  } finally {
    await browser.close();
  }
  console.log('✓ facility-linen screenshots done');
}

main().catch((e) => {
  console.error(`✗ screenshots failed: ${e.message}`);
  process.exit(1);
});
