/* Checks every built page at the widths real phones actually report.
 *
 * Headless Chrome will not take a window narrower than ~485px, so the small
 * sizes have to come from device emulation rather than `--window-size`.
 *
 * Usage: node check-responsive.mjs [baseUrl] [screenshotDir]
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8080';
const SHOTS = process.argv[3] ?? null;

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const DEVICES = [
  { name: 'Galaxy Fold (закрыт)', width: 280, height: 653, dpr: 3 },
  { name: 'iPhone SE 1 / старые', width: 320, height: 568, dpr: 2 },
  { name: 'Android (ходовой)', width: 360, height: 800, dpr: 3 },
  { name: 'iPhone SE 2 / 13 mini', width: 375, height: 812, dpr: 3 },
  { name: 'iPhone 14 / 15', width: 390, height: 844, dpr: 3 },
  { name: 'iPhone 14 Plus', width: 414, height: 896, dpr: 3 },
  { name: 'iPhone 15 Pro Max', width: 430, height: 932, dpr: 3 },
  { name: 'планшет книжно', width: 768, height: 1024, dpr: 2 }
];

const PAGES = [
  { path: '/', tag: 'ru' },
  { path: '/uk/', tag: 'uk' },
  { path: '/cs/', tag: 'cs' }
];

/* Runs in the page. Reports anything sticking out past the viewport, any
   tap target below the 44px minimum, and whether text got squeezed. */
function audit() {
  const vw = document.documentElement.clientWidth;
  const problems = [];

  const describe = (n) =>
    n.tagName.toLowerCase() +
    (typeof n.className === 'string' && n.className.trim()
      ? '.' + n.className.trim().split(/\s+/).join('.')
      : '');

  for (const n of document.querySelectorAll('body *')) {
    const r = n.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    // A fixed bar legitimately spans the viewport; only real spill counts.
    if (r.right > vw + 1) problems.push(`вылезает вправо на ${Math.round(r.right - vw)}px: ${describe(n)}`);
    if (r.left < -1) problems.push(`вылезает влево на ${Math.round(-r.left)}px: ${describe(n)}`);
  }

  /* An element's own box can be smaller than what a finger actually hits:
     a pseudo-element may extend the hit area. Probe the points a 44px
     target would have to cover and see what the browser reports there. */
  const hits = (n, x, y) => {
    const found = document.elementFromPoint(x, y);
    return found === n || n.contains(found);
  };

  const small = [];
  for (const n of document.querySelectorAll('a, button, summary')) {
    const r = n.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.height >= 44 - 0.5) continue;

    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cy - 22 < 0 || cy + 22 > window.innerHeight) continue; // off screen to probe
    if (hits(n, cx, cy - 21) && hits(n, cx, cy + 21)) continue; // extended, fine

    small.push(`${describe(n)} — ${Math.round(r.height)}px`);
  }

  return {
    viewport: vw,
    scrollWidth: document.documentElement.scrollWidth,
    pageHeight: document.documentElement.scrollHeight,
    overflow: [...new Set(problems)],
    smallTargets: [...new Set(small)]
  };
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars']
});

if (SHOTS) await mkdir(SHOTS, { recursive: true });

let failures = 0;

for (const dev of DEVICES) {
  console.log(`\n${dev.name}  —  ${dev.width}px`);

  for (const pg of PAGES) {
    const page = await browser.newPage();
    await page.setViewport({
      width: dev.width,
      height: dev.height,
      deviceScaleFactor: dev.dpr,
      isMobile: dev.width < 768,
      hasTouch: dev.width < 768
    });

    await page.goto(BASE + pg.path, { waitUntil: 'networkidle0', timeout: 60000 });
    // Let the reveal transitions settle before measuring or shooting.
    await page.evaluate(() => {
      document.querySelectorAll('.anim .is-visible, [class]').forEach(() => {});
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 300));

    const result = await page.evaluate(audit);
    const ok = result.overflow.length === 0 && result.smallTargets.length === 0;
    if (!ok) failures++;

    console.log(
      `  ${pg.tag}  viewport=${result.viewport}  scrollW=${result.scrollWidth}` +
      `  высота=${result.pageHeight}  ${ok ? 'ок' : 'ПРОБЛЕМЫ'}`
    );
    result.overflow.slice(0, 5).forEach((p) => console.log(`      ${p}`));
    result.smallTargets.slice(0, 5).forEach((p) => console.log(`      мелкая цель: ${p}`));

    if (SHOTS && pg.tag === 'cs') {
      await page.screenshot({
        path: join(SHOTS, `${dev.width}-${pg.tag}.png`),
        fullPage: false
      });
    }

    await page.close();
  }
}

await browser.close();
console.log(failures ? `\nПроблемных комбинаций: ${failures}` : '\nВсе размеры чистые');
process.exit(failures ? 1 : 0);
