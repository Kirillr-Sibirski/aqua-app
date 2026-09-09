#!/usr/bin/env node
/**
 * Redraw `src/app/favicon.ico` from `src/app/icon.svg`.
 *
 * Next serves the SVG to everything modern, but a browser that ignores `rel="icon"` with an SVG
 * type — and every bookmark bar, pinned tab and OS shortcut that reaches for `/favicon.ico` — gets
 * the ICO, so the two have to be the same drawing. Keeping the ICO checked in means the build has
 * no rasteriser dependency; running this after editing the SVG is the only step, and the operator
 * reworking the mark edits one file.
 *
 * Rasterises with the Chrome the repo already has for browser checks (Puppeteer's download cache),
 * at 16 and 32, then packs both as PNGs inside an ICO container. PNG-in-ICO is understood by every
 * browser since IE11 and is a fifth of the size of the BMP form.
 *
 *   node scripts/favicon.mjs
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SVG = join(here, '..', 'src', 'app', 'icon.svg');
const ICO = join(here, '..', 'src', 'app', 'favicon.ico');
const SIZES = [16, 32];

/** The newest Chrome for Testing in Puppeteer's cache. Nothing is downloaded by this script. */
function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  if (!existsSync(root)) return undefined;
  const builds = readdirSync(root).sort();
  for (const build of builds.reverse()) {
    const bin = join(
      root,
      build,
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing',
    );
    if (existsSync(bin)) return bin;
    const linux = join(root, build, 'chrome-linux64', 'chrome');
    if (existsSync(linux)) return linux;
  }
  return undefined;
}

async function loadPuppeteer() {
  for (const specifier of ['puppeteer-core', 'puppeteer']) {
    try {
      return (await import(specifier)).default;
    } catch {
      /* try the next one */
    }
  }
  return undefined;
}

/** ICO: a 6-byte header, a 16-byte directory entry per image, then the payloads. */
function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width  (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette size: none
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const puppeteer = await loadPuppeteer();
const executablePath = findChrome();
if (!puppeteer || !executablePath) {
  console.error(
    'favicon: needs puppeteer-core and a Chrome for Testing build in ~/.cache/puppeteer.\n' +
      'The committed favicon.ico is unchanged.',
  );
  process.exit(1);
}

const svg = readFileSync(SVG, 'utf8');
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();

const images = [];
for (const size of SIZES) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  // `background: transparent` on the page, opaque ground in the SVG itself: the rounded corners
  // stay transparent instead of picking up white.
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    { waitUntil: 'load' },
  );
  const png = await page.screenshot({ omitBackground: true, type: 'png' });
  images.push({ size, png: Buffer.from(png) });
}
await browser.close();

writeFileSync(ICO, packIco(images));
console.log(`favicon: wrote ${ICO} (${SIZES.join(', ')}px, ${(readFileSync(ICO).length / 1024).toFixed(1)} kB)`);
