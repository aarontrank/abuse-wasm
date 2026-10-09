// Boots dist/ in headless Chromium and checks the game really draws.
//
//   cd test && npm install && npx playwright install chromium && npm test
//
// Fails on any uncaught page error or runtime abort, when the first screen
// does not render, and when the game cannot be driven into a level where
// holding Right scrolls the view.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.css': 'text/css' };
const BOOT_MS = +(process.env.BOOT_MS || 20000);

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = path === '/' ? 'index.html' : path;
  try {
    const body = await readFile(join(DIST, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

// On some hosts V8's wasm trap handler turns an out-of-bounds access into a
// renderer crash instead of a catchable error.
const browser = await chromium.launch({ args: ['--js-flags=--no-wasm-trap-handler', '--autoplay-policy=no-user-gesture-required'] });
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', e => failures.push(`page error: ${e.message}`));
  page.on('crash', () => failures.push('renderer crashed'));
  await page.goto(url);
  await page.waitForTimeout(BOOT_MS);

  const canvas = await page.evaluate(() => {
    const c = document.getElementById('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0; const colors = new Set();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] | d[i + 1] | d[i + 2]) lit++;
      colors.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    }
    return { width: c.width, height: c.height, litFraction: lit / (c.width * c.height), colors: colors.size };
  });
  console.log('canvas', JSON.stringify(canvas));
  if (canvas.width !== 640 || canvas.height !== 400) failures.push(`unexpected canvas size ${canvas.width}x${canvas.height}`);
  if (canvas.litFraction < 0.25) failures.push(`first screen did not render (lit fraction ${canvas.litFraction.toFixed(3)})`);
  if (canvas.colors < 16) failures.push(`first screen has only ${canvas.colors} colours`);

  await page.click('#start');

  // Into the first level: pick a grey and confirm the gamma dialog, then the
  // main menu's start icon. Coordinates are in the 640x400 game canvas.
  const box = await page.locator('#canvas').boundingBox();
  const click = (x, y) => page.mouse.click(box.x + x * box.width / 640, box.y + y * box.height / 400);
  const pixels = () => page.evaluate(() => {
    const c = document.getElementById('canvas');
    return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
  });
  const changed = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
  await click(185, 150); await page.waitForTimeout(300);
  await click(108, 318); await page.waitForTimeout(9000);
  await click(605, 25); await page.waitForTimeout(7000);
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
  await page.waitForTimeout(500);

  const still = await pixels(); await page.waitForTimeout(800);
  const idle = changed(still, await pixels());
  const before = await pixels();
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(1500); await page.keyboard.up('ArrowRight');
  const moved = changed(before, await pixels());
  console.log('level', JSON.stringify({ idleChanged: idle, rightChanged: moved }));
  if (moved < 20000) failures.push(`holding Right barely changed the frame (${moved} px): not in a playable level`);
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error('FAIL\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('PASS');
