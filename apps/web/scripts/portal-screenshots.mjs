/* eslint-disable no-console */
/**
 * Real-browser screenshots of the B2B invoice portal (light + dark) via puppeteer-core + the system
 * Chrome (no bundled-Chromium download). Logs in ONCE as the condo property-manager (ACCOUNT_ADMIN),
 * injects the refresh token into localStorage so the app hydrates the real session, then captures the
 * portal in both themes (the app keeps its rotating refresh token in localStorage, so reloads re-auth).
 *
 * STAGE=issued (default) → my-invoices, invoice-detail (split + Pay + Download), pay-surface (modal).
 * STAGE=paid            → receipt (the PAID detail).
 *
 * Prereq: the API at API_BASE (CORS allowing WEB_BASE) and the web build served at WEB_BASE; seed applied.
 * Run: STAGE=issued node apps/web/scripts/portal-screenshots.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000';
const WEB_BASE = process.env.WEB_BASE ?? 'http://localhost:3001';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT_DIR = process.env.OUT_DIR ?? '/Volumes/Gowtham/Blue Bee/Projects/Blue Bee/screenshots/web-console/b2b-portal';
const PHONE = process.env.PORTAL_PHONE ?? '+14165550022';
const STAGE = process.env.STAGE ?? 'issued';

async function api(method, path, body) {
  const res = await fetch(`${API_BASE}/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}
async function login(phone) {
  const otp = await api('POST', '/auth/otp', { phone });
  if (!otp.devCode) throw new Error('no devCode (SMS_TRANSPORT=console?)');
  return api('POST', '/auth/verify', { phone, code: otp.devCode }); // { accessToken, refreshToken }
}
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`▶ Portal screenshots (STAGE=${STAGE}) → ${OUT_DIR}`);
  const { accessToken, refreshToken } = await login(PHONE);
  const list = await fetch(`${API_BASE}/v1/invoices?limit=100`, { headers: { authorization: `Bearer ${accessToken}` } }).then((r) => r.json());
  const target = list.invoices.find((i) => i.number === 'DEMO-CONDO-2026-06') ?? list.invoices[0];
  if (!target) throw new Error('no invoice to screenshot');
  console.log(`  using invoice ${target.number} (${target.status})`);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1380, height: 1000, deviceScaleFactor: 2 });
  await page.goto(WEB_BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((rt) => localStorage.setItem('bb.console.refresh', rt), refreshToken);

  const shot = async (name) => {
    await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
    console.log(`  ✓ ${name}.png`);
  };

  const captureFor = async (theme) => {
    await page.evaluate((th) => localStorage.setItem('bb-theme', th), theme);
    // my invoices (also (re-)hydrates the session via the rotating refresh token in localStorage)
    await page.goto(`${WEB_BASE}/portal`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-testid^="invoice-"]', { timeout: 25000 });
    await settle();
    if (STAGE === 'issued') await shot(`my-invoices-${theme}`);

    // invoice detail
    await page.goto(`${WEB_BASE}/portal/${target.id}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Line items'), { timeout: 25000 });
    await settle();
    await shot(STAGE === 'paid' ? `receipt-${theme}` : `invoice-detail-${theme}`);

    if (STAGE === 'issued') {
      const clicked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /^Pay\s/.test((x.textContent || '').trim()));
        if (b) { b.click(); return true; }
        return false;
      });
      if (clicked) {
        await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
        await settle(1400);
        await shot(`pay-surface-${theme}`);
      } else {
        console.log(`  (no Pay button — not payable; skipping pay-surface-${theme})`);
      }
    }
  };

  try {
    await captureFor('light');
    await captureFor('dark');
  } finally {
    await browser.close();
  }
  console.log('✓ screenshots done');
}

main().catch((e) => {
  console.error(`✗ screenshots failed: ${e.message}`);
  process.exit(1);
});
