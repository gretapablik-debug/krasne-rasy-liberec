/* Renders one static page per language from src/template.html + src/i18n.js.
 *
 * Why static pages rather than switching copy in the browser: a crawler sees
 * only what is in the HTML it is served. With a single document the Czech and
 * Ukrainian copy was invisible to search — which is backwards for a stylist
 * whose home market is Czech.
 *
 * Run `npm run build` after editing the template or the dictionary, and commit
 * what it writes: Cloudflare Pages serves this repository as-is, with no build
 * step of its own.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';

import { I18N } from '../src/i18n.js';

// The tooling lives in tools/ so the repository root stays plain static
// files: Cloudflare Pages treats a root package.json as a Node project and
// tries to install and build, which is neither needed nor wanted here.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://krasnerasy.online';

const PHONE = '+420792931153';
const WHATSAPP = '+380958887131';
const INSTAGRAM = 'https://instagram.com/krasnerasy_liberec';

const WORK_IMAGES = ['/assets/work-1.webp', '/assets/work-2.webp', '/assets/work-3.webp'];
const REVIEW_IMAGES = ['/assets/review-1.webp', '/assets/review-2.webp', '/assets/review-3.webp'];

/** dictKey: the key in I18N; tag: the BCP 47 tag for hreflang and <html lang>. */
const LOCALES = [
  { dictKey: 'ru', tag: 'ru', locale: 'ru_RU', path: '', out: 'index.html', og: 'og-ru.jpg' },
  { dictKey: 'ua', tag: 'uk', locale: 'uk_UA', path: 'uk/', out: 'uk/index.html', og: 'og-uk.jpg' },
  { dictKey: 'cz', tag: 'cs', locale: 'cs_CZ', path: 'cs/', out: 'cs/index.html', og: 'og-cs.jpg' }
];

/* The share cards are 1200x630 because Telegram, WhatsApp and Facebook all
   crop previews to roughly that shape; a portrait image loses its text. They
   are generated once by hand, not at build time, since rendering them needs a
   browser. See README. */
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const urlFor = (loc) => `${ORIGIN}/${loc.path}`;

// ---------------------------------------------------------------- list views

const LIST_BUILDERS = {
  main: (rows) => rows.map((row) => `
      <div class="price-row">
        <div class="price-row__label">
          <span class="price-row__name">${esc(row.name)}</span>
          <span class="price-row__desc">${esc(row.desc)}</span>
        </div>
        <span class="price-row__value">${esc(row.price)}</span>
      </div>`),

  extras: (rows) => rows.map((row) => `
      <div class="extra-row">
        <span class="extra-row__name">${esc(row.name)}</span>
        <span class="extra-row__value">${esc(row.price)}</span>
      </div>`),

  why: (items) => items.map((title, i) => `
      <div class="card">
        <div class="card__n">${i + 1}</div>
        <span class="card__title">${esc(title)}</span>
      </div>`),

  aboutFacts: (items) => items.map((fact) => `
      <span class="fact">${esc(fact)}</span>`),

  steps: (items) => items.map((step, i) => `
      <div class="step">
        <span class="step__n">${i + 1}</span>
        <span class="step__t">${esc(step.t)}</span>
        <span class="step__d">${esc(step.d)}</span>
      </div>`),

  works: (names, dict) => names.map((name, i) => `
      <div class="work">
        <img src="${WORK_IMAGES[i]}" width="760" height="950" loading="lazy"
             alt="${esc(`${dict.priceSub} — ${name}`)}">
      </div>`),

  reviews: (_unused, dict) => REVIEW_IMAGES.map((src, i) => `
      <div class="review">
        <img src="${src}" width="820" height="1457" loading="lazy"
             alt="${esc(`${dict.reviewAlt} ${i + 1}`)}">
      </div>`),

  faq: (items) => items.map((qa) => `
      <details class="faq-item">
        <summary>${esc(qa.q)}</summary>
        <p>${esc(qa.a)}</p>
      </details>`)
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// -------------------------------------------------------------- structured data

/* Two graphs: the business itself, so the phone, prices and area can show in a
   local result, and the question list, which search engines expand inline. */
function structuredData(dict, loc) {
  const business = {
    '@context': 'https://schema.org',
    '@type': 'BeautySalon',
    '@id': `${urlFor(loc)}#business`,
    name: 'Krásné řasy Liberec',
    description: dict.metaDescription,
    url: urlFor(loc),
    image: `${ORIGIN}/assets/${loc.og}`,
    telephone: PHONE,
    priceRange: '500–900 Kč',
    address: { '@type': 'PostalAddress', addressLocality: 'Liberec', addressCountry: 'CZ' },
    areaServed: { '@type': 'City', name: 'Liberec' },
    availableLanguage: LOCALES.map((l) => l.tag),
    sameAs: [INSTAGRAM],
    makesOffer: dict.main.map((row) => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Service', name: `${dict.priceSub} — ${row.name}` },
      price: row.price.replace(/[^\d]/g, ''),
      priceCurrency: 'CZK'
    }))
  };

  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${urlFor(loc)}#faq`,
    inLanguage: loc.tag,
    mainEntity: dict.faq.map((qa) => ({
      '@type': 'Question',
      name: qa.q,
      acceptedAnswer: { '@type': 'Answer', text: qa.a }
    }))
  };

  return [business, faq];
}

// -------------------------------------------------------------------- render

function render(template, loc) {
  const dict = I18N[loc.dictKey];
  // Document mode, not fragment mode: fragment mode drops the doctype and the
  // html/head/body elements, which also leaves nothing to append the
  // structured data to.
  const $ = cheerio.load(template);

  $('[data-t]').each((_, node) => {
    const value = dict[$(node).attr('data-t')];
    if (typeof value === 'string') $(node).text(value);
  });

  $('[data-t-alt]').each((_, node) => {
    const value = dict[$(node).attr('data-t-alt')];
    if (typeof value === 'string') $(node).attr('alt', value);
  });

  $('[data-t-aria-label]').each((_, node) => {
    const value = dict[$(node).attr('data-t-aria-label')];
    if (typeof value === 'string') $(node).attr('aria-label', value);
  });

  $('[data-list]').each((_, node) => {
    const key = $(node).attr('data-list');
    const build = LIST_BUILDERS[key];
    if (build) $(node).html(build(dict[key], dict).join('\n'));
  });

  // Headings rise out from behind their own box, which needs an inner element
  // to move while the heading itself stays put as the mask. Done after the
  // copy is in place, since setting text would wipe the span out.
  $('h1, h2').each((_, node) => {
    const el = $(node);
    el.html(`<span class="rise">${esc(el.text())}</span>`);
  });

  $('html').attr('lang', loc.tag);
  $('title').text(dict.metaTitle);
  $('meta[name="description"]').attr('content', dict.metaDescription);

  $('meta[property="og:title"]').attr('content', dict.metaTitle);
  $('meta[property="og:description"]').attr('content', dict.metaDescription);
  $('meta[property="og:url"]').attr('content', urlFor(loc));
  $('meta[property="og:locale"]').attr('content', loc.locale);
  $('meta[property="og:locale:alternate"]').remove();
  LOCALES.filter((l) => l !== loc).forEach((l) => {
    $('meta[property="og:locale"]').after(
      `\n<meta property="og:locale:alternate" content="${l.locale}">`
    );
  });

  $('meta[property="og:image"]').attr('content', `${ORIGIN}/assets/${loc.og}`);
  $('meta[property="og:image:width"]').attr('content', String(OG_WIDTH));
  $('meta[property="og:image:height"]').attr('content', String(OG_HEIGHT));

  $('link[rel="canonical"]').attr('href', urlFor(loc));

  // hreflang has to list every version including this one, or search engines
  // treat the set as incomplete and may ignore it.
  $('link[rel="alternate"]').remove();
  const alternates = [
    ...LOCALES.map((l) => `<link rel="alternate" hreflang="${l.tag}" href="${urlFor(l)}">`),
    `<link rel="alternate" hreflang="x-default" href="${ORIGIN}/">`
  ].join('\n');
  $('link[rel="canonical"]').after('\n' + alternates);

  $('.lang a').each((_, node) => {
    const el = $(node);
    if (el.attr('data-lang') === loc.dictKey) el.attr('aria-current', 'page');
    else el.removeAttr('aria-current');
  });

  $('script[type="application/ld+json"]').remove();
  $('body').append(
    `\n<script type="application/ld+json">${JSON.stringify(structuredData(dict, loc))}</script>\n`
  );

  return $.html();
}

// ------------------------------------------------------------------ sitemap

function sitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const entries = LOCALES.map((loc) => {
    const links = LOCALES.map(
      (l) => `    <xhtml:link rel="alternate" hreflang="${l.tag}" href="${urlFor(l)}"/>`
    ).join('\n');
    return `  <url>
    <loc>${urlFor(loc)}</loc>
    <lastmod>${today}</lastmod>
${links}
  </url>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries}
</urlset>
`;
}

// --------------------------------------------------------------------- main

const template = await readFile(join(ROOT, 'src/template.html'), 'utf8');

for (const loc of LOCALES) {
  const out = join(ROOT, loc.out);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, render(template, loc), 'utf8');
  console.log(`${loc.out.padEnd(16)} ${loc.tag}  ${urlFor(loc)}`);
}

await writeFile(join(ROOT, 'sitemap.xml'), sitemap(), 'utf8');
console.log('sitemap.xml      3 urls');
