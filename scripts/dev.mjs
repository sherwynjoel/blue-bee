#!/usr/bin/env node
// Blue Bee local development runner. Full guide: docs/LOCAL-DEV.md
//
//   npm run setup                    one-time: apps/api/.env, Docker infra, migrations, seed, test logins
//   npm run dev:all                  API + web (console & business portal) + customer, driver, owner apps
//   npm run dev:all -- customer      API + web + only the named app(s)
//   npm run dev:all -- --web-only    API + web only (lightest on RAM)
//
// Node built-ins only, so it needs nothing installed; works on Windows, macOS and Linux.
// While running: type `rs` + Enter to restart the API after editing apps/api; Ctrl+C stops everything.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';
const API_ENV = path.join(ROOT, 'apps', 'api', '.env');
const API_PORT = 3000;
const WEB_PORT = 3001;
const MINIO_PORT = 9000;
const APPS = { customer: 8081, driver: 8082, owner: 8083 }; // one Metro port per app — they can't share
const COLORS = { api: 35, web: 34, customer: 32, driver: 33, owner: 36 };
const children = new Map(); // name -> ChildProcess started by this runner

const info = (msg) => console.log(`\x1b[36m›\x1b[0m ${msg}`);
const warn = (msg) => console.warn(`\x1b[33m!\x1b[0m ${msg}`);
const die = (msg) => {
  console.error(`\n\x1b[31m✖\x1b[0m ${msg}\n`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run a command to completion with its output shown; stop the runner if it fails. */
function sh(cmd, cwd = ROOT, env = process.env) {
  const { status } = spawnSync(cmd, { cwd, env, stdio: 'inherit', shell: true });
  if (status !== 0) die(`\`${cmd}\` failed (exit ${status}) in ${path.relative(ROOT, cwd) || '.'}`);
}

/** True if anything accepts TCP connections on the port (IPv4 or IPv6 loopback). */
async function isListening(port) {
  const probe = (host) =>
    new Promise((resolve) => {
      const s = net.connect({ port, host });
      s.setTimeout(700);
      s.once('connect', () => (s.destroy(), resolve(true)));
      s.once('timeout', () => (s.destroy(), resolve(false)));
      s.once('error', () => resolve(false));
    });
  return (await probe('127.0.0.1')) || (await probe('::1'));
}

function setEnvLine(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
}

function dbPort() {
  const url = /^DATABASE_URL=(.*)$/m.exec(readFileSync(API_ENV, 'utf8'))?.[1]?.trim();
  return (url && new URL(url).port) || '5432';
}

// ── Docker infra ────────────────────────────────────────────────────────────────────────────────
function infraUp() {
  // Docker Desktop on Windows doesn't always put its bin dir on PATH; without it even
  // `docker-credential-desktop` is missing and image pulls fail.
  const winDocker = 'C:\\Program Files\\Docker\\Docker\\resources\\bin';
  if (IS_WIN && existsSync(winDocker) && !process.env.PATH.includes(winDocker)) {
    process.env.PATH = `${winDocker};${process.env.PATH}`;
  }
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
    die('Docker is not running (or not installed). Start Docker Desktop, wait until it says "running", then re-run.');
  }
  const port = dbPort();
  info(`Docker: Postgres on :${port}, Redis on :6379, MinIO on :${MINIO_PORT}…`);
  // POSTGRES_PORT feeds infra/docker-compose.yml, so a machine whose own Postgres owns 5432 still works.
  sh('docker compose -f infra/docker-compose.yml up -d --wait', ROOT, { ...process.env, POSTGRES_PORT: port });
}

// ── npm run setup ───────────────────────────────────────────────────────────────────────────────
async function setup() {
  if (process.versions.node.split('.')[0] !== '20') {
    warn(`Node ${process.versions.node} — the repo targets Node 20 (.nvmrc). Newer usually works; switch to 20 if something odd happens.`);
  }
  if (!existsSync(path.join(ROOT, 'node_modules'))) sh('npm install');

  if (existsSync(API_ENV)) {
    info('apps/api/.env already exists — keeping it.');
  } else {
    let port = 5432; // a local Postgres install (common on Windows) often already owns 5432
    while ((await isListening(port)) && port < 5440) port += 1;
    if (await isListening(port)) die('Ports 5432-5440 are all in use — free one and re-run.');
    let env = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    env = setEnvLine(env, 'DATABASE_URL', `postgresql://bluebee:bluebee@localhost:${port}/bluebee`);
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'OTP_PEPPER', 'CHANNEL_TOKEN_SECRET']) {
      env = setEnvLine(env, k, randomBytes(32).toString('hex'));
    }
    env = setEnvLine(env, 'OTP_DEV_BYPASS_CODE', '000000'); // local only; forced off when NODE_ENV=production
    env = setEnvLine(env, 'OTP_RATE_PER_PHONE', '1000'); // the default 5/hour kept locking testers out
    env = setEnvLine(env, 'OTP_RATE_PER_IP', '1000');
    writeFileSync(API_ENV, env);
    info(`Created apps/api/.env (Postgres on port ${port}).`);
  }

  infraUp();
  const api = path.join(ROOT, 'apps', 'api');
  sh('npx prisma generate', api);
  sh('npx prisma migrate deploy', api);
  sh('npm run db:seed', api);
  sh('npm run db:operator', api);
  console.log('\n\x1b[32m✔\x1b[0m Setup done. Start everything with:  npm run dev:all   (guide: docs/LOCAL-DEV.md)\n');
}

// ── npm run dev:all ─────────────────────────────────────────────────────────────────────────────
/** GET a URL as text ('' on any error). Plain http.get with no keep-alive: fetch()'s pooled socket can
 *  still be closing when die() exits, which trips a libuv assertion on Windows. */
function httpGet(url, headers = {}, timeout = 30000) {
  return new Promise((resolve) => {
    const req = http.get(url, { agent: false, timeout, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve(text));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(''));
  });
}

/** 'free' | 'ours' (a Blue Bee server is already up — reuse it); dies if a different program holds the port. */
async function portOwner(name, port, url, marker) {
  if (!(await isListening(port))) return 'free';
  if ((await httpGet(url)).includes(marker)) return 'ours';
  const find = IS_WIN ? `netstat -ano | findstr :${port}` : `lsof -i :${port}`;
  return die(`Port ${port} is used by another program, but Blue Bee's ${name} needs it. Stop that program and re-run (find it with: ${find}).`);
}

function androidSdk() {
  const home = os.homedir();
  const byOs = IS_WIN
    ? path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Android', 'sdk')
      : path.join(home, 'Android', 'Sdk');
  return [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, byOs].find((p) => p && existsSync(path.join(p, 'platform-tools')));
}

/** React Native 0.74's native libraries are 4 KB-aligned and won't install on 16 KB page-size images. */
function pickAvd(sdk) {
  if (process.env.BLUEBEE_AVD) return process.env.BLUEBEE_AVD;
  const names = spawnSync(path.join(sdk, 'emulator', `emulator${EXE}`), ['-list-avds'], { encoding: 'utf8' })
    .stdout.split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const avdHome = process.env.ANDROID_AVD_HOME ?? path.join(os.homedir(), '.android', 'avd');
  const imageOf = (name) => {
    const ini = path.join(avdHome, `${name}.ini`);
    const dir = existsSync(ini) ? /^path=(.*)$/m.exec(readFileSync(ini, 'utf8'))?.[1]?.trim() : undefined;
    const cfg = dir ? path.join(dir, 'config.ini') : '';
    return cfg && existsSync(cfg) ? (/^image\.sysdir\.1=(.*)$/m.exec(readFileSync(cfg, 'utf8'))?.[1] ?? '') : '';
  };
  const avd = names.find((n) => !/16k/i.test(imageOf(n)));
  if (avd) return avd;
  return die(
    names.length
      ? `Your emulators (${names.join(', ')}) all use 16 KB page-size images, which this React Native version can't install on. In Android Studio → Device Manager, create one with a regular image (e.g. Pixel 6, API 34 "Google APIs").`
      : 'No Android emulator found. In Android Studio → Device Manager, create one (e.g. Pixel 6, API 34 "Google APIs" — not a "16 KB page size" image).',
  );
}

/** Boot/attach the emulator, forward the host ports it needs, and build any app not yet installed on it. */
async function prepareAndroid(apps) {
  const sdk = androidSdk();
  if (!sdk) {
    warn('Android SDK not found (install Android Studio, or set ANDROID_HOME) — skipping the mobile apps.');
    return { apps: [] };
  }
  process.env.ANDROID_HOME = sdk; // Gradle needs it for first-time builds
  const adb = (...args) => spawnSync(path.join(sdk, 'platform-tools', `adb${EXE}`), args, { encoding: 'utf8' }).stdout ?? '';

  let devices = adb('devices');
  if (/\tunauthorized/.test(devices)) {
    die('The emulator is asking for permission: on its screen tick "Always allow from this computer", press Allow, then re-run.');
  }
  if (!/\tdevice\b/.test(devices)) {
    const avd = pickAvd(sdk);
    info(`Booting Android emulator "${avd}" (set BLUEBEE_AVD to choose another)…`);
    spawn(path.join(sdk, 'emulator', `emulator${EXE}`), ['-avd', avd], { detached: true, stdio: 'ignore' }).unref();
    adb('wait-for-device');
    for (let i = 0; adb('shell', 'getprop', 'sys.boot_completed').trim() !== '1'; i += 1) {
      if (i > 150) die('The emulator did not finish booting within 5 minutes.');
      await sleep(2000);
    }
  }
  if (adb('shell', 'getconf', 'PAGE_SIZE').trim() === '16384') {
    die('The running emulator uses 16 KB memory pages, which this React Native version cannot install on. Close it and re-run — the script will boot a 4 KB one.');
  }
  // The emulator's "localhost" is itself: forward the API, MinIO (signed photo URLs) and each app's Metro port.
  for (const p of [API_PORT, MINIO_PORT, ...apps.map((a) => APPS[a])]) adb('reverse', `tcp:${p}`, `tcp:${p}`);

  const installed = adb('shell', 'pm', 'list', 'packages', 'com.bluebee.').split(/\r?\n/).map((l) => l.trim());
  for (const app of apps.filter((a) => !installed.includes(`package:com.bluebee.${a}`))) {
    info(`${app}: not on this emulator yet — building it once (5-15 min).`);
    // No --port (Expo rejects it with --no-bundler); openWhenReady() hands the app its bundler URL.
    sh('npx expo run:android --no-bundler', path.join(ROOT, 'apps', app));
  }
  return { apps, adb };
}

/** Open an app on the emulator once its Metro bundle is built. The first bundle takes a minute or two;
 *  opening the app earlier makes the dev client give up with "There was a problem loading the project: timeout". */
async function openWhenReady(app, adb) {
  const port = APPS[app];
  for (let i = 0; !(await httpGet(`http://localhost:${port}/status`)).includes('packager-status:running'); i += 1) {
    if (i > 180) return warn(`${app}: Metro didn't start on :${port} — check the [${app}] log.`);
    await sleep(1000);
  }
  let manifest = {};
  try {
    manifest = JSON.parse(await httpGet(`http://localhost:${port}/`, { 'expo-platform': 'android' }));
  } catch {
    /* fall through: open anyway, the dev client will fetch it */
  }
  if (manifest.launchAsset?.url) {
    info(`${app}: building its JavaScript bundle (first time takes a minute or two)…`);
    await httpGet(manifest.launchAsset.url, {}, 10 * 60_000);
  }
  const slug = JSON.parse(readFileSync(path.join(ROOT, 'apps', app, 'app.json'), 'utf8')).expo.slug;
  const url = `exp+${slug}://expo-development-client/?url=${encodeURIComponent(`http://127.0.0.1:${port}`)}`;
  adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `"${url}"`);
  info(`${app}: opened on the emulator.`);
}

function run(name, cmd, dir) {
  const child = spawn(cmd, {
    cwd: path.join(ROOT, dir),
    shell: true,
    // Piped output makes tools drop colour; force it back unless the user opted out with NO_COLOR.
    env: process.env.NO_COLOR ? process.env : { ...process.env, FORCE_COLOR: '1' },
    detached: !IS_WIN, // own process group on macOS/Linux so the whole tree can be stopped
  });
  const tag = `\x1b[${COLORS[name]}m[${name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    readline.createInterface({ input: stream }).on('line', (line) => console.log(tag + line));
  }
  child.on('exit', (code) => {
    if (children.get(name) !== child) return;
    children.delete(name);
    console.log(`${tag}stopped (exit ${code ?? 'signal'})`);
  });
  children.set(name, child);
}

function kill(child) {
  if (IS_WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

async function dev(args) {
  if (!existsSync(API_ENV)) die('No apps/api/.env yet — run `npm run setup` first.');
  const webOnly = args.includes('--web-only');
  const names = args.filter((a) => a !== '--web-only');
  const unknown = names.find((a) => !(a in APPS));
  if (unknown) die(`Unknown app "${unknown}". Choose from: ${Object.keys(APPS).join(', ')} (or --web-only).`);
  const wanted = webOnly ? [] : names.length ? names : Object.keys(APPS);

  infraUp();
  const api = await portOwner('API', API_PORT, `http://localhost:${API_PORT}/v1/health`, 'blue-bee-api');
  const web = await portOwner('web console', WEB_PORT, `http://localhost:${WEB_PORT}/`, 'Blue Bee');
  const { apps, adb } = wanted.length ? await prepareAndroid(wanted) : { apps: [] };

  if (api === 'ours') info('API already running on :3000 — reusing it.');
  else run('api', 'npm run start:dev', 'apps/api');
  if (web === 'ours') info('Web already running on :3001 — reusing it.');
  else run('web', 'npm run dev', 'apps/web');
  for (const app of apps) {
    run(app, `npx expo start --dev-client --port ${APPS[app]}`, `apps/${app}`);
    openWhenReady(app, adb); // runs alongside; opens the app once its bundle is built
  }

  console.log(`
  \x1b[1mBlue Bee is starting\x1b[0m (first start takes ~30 s)
    Console + business portal   http://localhost:${WEB_PORT}
    API                         http://localhost:${API_PORT}/v1   (docs: /v1/docs)
    Sign-in code for every login: 000000
      console  +14165557777    portal  +14165550020
      customer +14165550010    driver  +14165550101    owner  +14165550001
    Type \x1b[1mrs\x1b[0m + Enter to restart the API · Ctrl+C to stop everything
`);

  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    if (line.trim() !== 'rs') return;
    const current = children.get('api');
    if (!current) return warn('The API was not started by this runner — restart it where it is running.');
    children.delete('api');
    kill(current);
    while (await isListening(API_PORT)) await sleep(300);
    run('api', 'npm run start:dev', 'apps/api');
  });
  const stop = () => {
    for (const child of children.values()) kill(child);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

const args = process.argv.slice(2);
if (args[0] === 'setup') await setup();
else await dev(args);
