/* Krásné řasy Liberec — language switching, reveal animations, smooth scrolling.
 *
 * Animation rules kept here on purpose:
 *  - only `opacity` and `transform` are animated, so every frame stays on the
 *    compositor and the page can hold 120 Hz on a high-refresh display;
 *  - durations are long (0.9-1.4s) with a soft ease-out curve;
 *  - everything is skipped when the visitor asked for reduced motion.
 *
 * The selector in REVEAL_SELECTOR must stay in sync with the `.anim` block in
 * styles.css, which holds the matching hidden-before-reveal state.
 */
(function () {
  'use strict';

  var LANGS = ['ru', 'ua', 'cz'];
  var STORAGE_KEY = 'kr-lang';

  var WORK_IMAGES = ['assets/work-1.webp', 'assets/work-2.webp', 'assets/work-3.webp'];
  var REVIEW_IMAGES = ['assets/review-1.webp', 'assets/review-2.webp', 'assets/review-3.webp'];

  var REVEAL_SELECTOR = [
    '.hero-copy > *', '.hero-frame',
    '.head-center', '.section > h2', '.wrap-820 > h2',
    '.price-row', '.extras', '.free',
    '.card', '.about__media', '.about__copy > *',
    '.step', '.work', '.review', '.faq-item',
    '.contact__copy > *', '.contact-link',
    '.footer'
  ].join(',');

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------------------------------------------------------------- helpers

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ------------------------------------------------------------- list views

  var LIST_BUILDERS = {
    main: function (rows) {
      return rows.map(function (row) {
        var wrap = el('div', 'price-row');
        var label = el('div', 'price-row__label');
        label.appendChild(el('span', 'price-row__name', row.name));
        label.appendChild(el('span', 'price-row__desc', row.desc));
        wrap.appendChild(label);
        wrap.appendChild(el('span', 'price-row__value', row.price));
        return wrap;
      });
    },

    extras: function (rows) {
      return rows.map(function (row) {
        var wrap = el('div', 'extra-row');
        wrap.appendChild(el('span', 'extra-row__name', row.name));
        wrap.appendChild(el('span', 'extra-row__value', row.price));
        return wrap;
      });
    },

    why: function (items) {
      return items.map(function (title, i) {
        var card = el('div', 'card');
        card.appendChild(el('div', 'card__n', String(i + 1)));
        card.appendChild(el('span', 'card__title', title));
        return card;
      });
    },

    aboutFacts: function (items) {
      return items.map(function (fact) {
        return el('span', 'fact', fact);
      });
    },

    steps: function (items) {
      return items.map(function (step, i) {
        var card = el('div', 'step');
        card.appendChild(el('span', 'step__n', String(i + 1)));
        card.appendChild(el('span', 'step__t', step.t));
        card.appendChild(el('span', 'step__d', step.d));
        return card;
      });
    },

    works: function (names, dict) {
      return names.map(function (name, i) {
        var wrap = el('div', 'work');
        var img = el('img');
        img.src = WORK_IMAGES[i];
        img.width = 760;
        img.height = 950;
        img.loading = 'lazy';
        img.alt = name;
        wrap.appendChild(img);
        wrap.appendChild(el('span', 'work__tag', dict.workSample));
        wrap.appendChild(el('span', 'work__name', name));
        return wrap;
      });
    },

    reviews: function (_unused, dict) {
      return REVIEW_IMAGES.map(function (src) {
        var wrap = el('div', 'review');
        var img = el('img');
        img.src = src;
        img.width = 820;
        img.height = 1457;
        img.loading = 'lazy';
        img.alt = dict.reviewSlot;
        wrap.appendChild(img);
        wrap.appendChild(el('span', 'review__label', dict.reviewSlot));
        return wrap;
      });
    },

    faq: function (items) {
      return items.map(function (qa) {
        var details = el('details', 'faq-item');
        details.appendChild(el('summary', null, qa.q));
        details.appendChild(el('p', null, qa.a));
        return details;
      });
    }
  };

  // ------------------------------------------------------------- rendering

  function applyStrings(dict) {
    document.querySelectorAll('[data-t]').forEach(function (node) {
      var value = dict[node.dataset.t];
      if (typeof value === 'string') node.textContent = value;
    });

    document.querySelectorAll('[data-t-alt]').forEach(function (node) {
      var value = dict[node.dataset.tAlt];
      if (typeof value === 'string') node.alt = value;
    });

    document.querySelectorAll('[data-t-aria-label]').forEach(function (node) {
      var value = dict[node.dataset.tAriaLabel];
      if (typeof value === 'string') node.setAttribute('aria-label', value);
    });
  }

  // `settle` skips the reveal animation for rows replaced on a language
  // switch: those sections are already on screen and should not fade again.
  // On the very first pass it stays off, so initReveal can pick the rows up.
  function applyLists(dict, settle) {
    document.querySelectorAll('[data-list]').forEach(function (host) {
      var key = host.dataset.list;
      var build = LIST_BUILDERS[key];
      if (!build) return;

      clear(host);
      build(dict[key], dict).forEach(function (node) {
        if (settle) node.classList.add('is-visible');
        host.appendChild(node);
      });
    });
  }

  function applyMeta(dict) {
    document.documentElement.lang = dict.htmlLang;
    document.title = dict.metaTitle;

    var description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', dict.metaDescription);

    var ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', dict.metaTitle);

    var ogDescription = document.querySelector('meta[property="og:description"]');
    if (ogDescription) ogDescription.setAttribute('content', dict.metaDescription);
  }

  function markActiveButton(lang) {
    document.querySelectorAll('#lang-switch button').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
    });
  }

  var fadeTimer = null;

  function setLanguage(lang, options) {
    var dict = window.I18N[lang];
    if (!dict) return;

    var animate = !(options && options.silent) && !reduceMotion.matches;
    var root = document.documentElement;

    var settle = !(options && options.silent);

    function paint() {
      applyStrings(dict);
      applyLists(dict, settle);
      applyMeta(dict);
      markActiveButton(lang);
    }

    if (!animate) {
      paint();
      return;
    }

    // Soft crossfade: dim the content, swap it, let it come back up.
    root.classList.add('is-switching');
    window.clearTimeout(fadeTimer);
    fadeTimer = window.setTimeout(function () {
      paint();
      fadeTimer = window.setTimeout(function () {
        root.classList.remove('is-switching');
      }, 40);
    }, 420);
  }

  function initialLanguage() {
    var fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (LANGS.indexOf(fromUrl) !== -1) return fromUrl;

    var stored = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      stored = null;
    }
    if (LANGS.indexOf(stored) !== -1) return stored;

    var preferred = (navigator.languages || [navigator.language || 'ru']).join(',').toLowerCase();
    if (/\bcs\b|\bcs-/.test(preferred)) return 'cz';
    if (/\buk\b|\buk-/.test(preferred)) return 'ua';
    return 'ru';
  }

  function initLanguage() {
    var lang = initialLanguage();
    // The markup already ships the Russian copy, so only a different
    // language needs a first pass — and it should not fade in.
    if (lang !== 'ru') setLanguage(lang, { silent: true });
    markActiveButton(lang);

    var group = document.getElementById('lang-switch');
    if (!group) return;

    group.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-lang]');
      if (!button) return;

      var next = button.dataset.lang;
      setLanguage(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch (err) {
        /* private mode — the choice just will not be remembered */
      }
    });
  }

  // ------------------------------------------------------- reveal on scroll

  function initReveal() {
    var targets = Array.prototype.slice.call(document.querySelectorAll(REVEAL_SELECTOR));
    if (!targets.length) return;

    if (reduceMotion.matches || !('IntersectionObserver' in window)) {
      targets.forEach(function (node) { node.classList.add('is-visible'); });
      return;
    }

    // Siblings arrive one after another instead of all at once.
    var seen = new Map();
    targets.forEach(function (node) {
      var index = seen.get(node.parentNode) || 0;
      seen.set(node.parentNode, index + 1);
      node.style.setProperty('--reveal-delay', Math.min(index * 90, 540) + 'ms');
    });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });

    targets.forEach(function (node) { observer.observe(node); });
  }

  // --------------------------------------------------------- smooth scroll

  var SCROLL_DURATION = 1150;

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function glideTo(top) {
    var start = window.scrollY;
    var distance = top - start;
    if (!distance) return;

    var startedAt = null;
    var cancelled = false;

    function stop() { cancelled = true; }
    // A visitor who grabs the page mid-flight takes over immediately.
    window.addEventListener('wheel', stop, { passive: true, once: true });
    window.addEventListener('touchstart', stop, { passive: true, once: true });
    window.addEventListener('keydown', stop, { once: true });

    function frame(now) {
      if (cancelled) return;
      if (startedAt === null) startedAt = now;

      var progress = Math.min((now - startedAt) / SCROLL_DURATION, 1);
      window.scrollTo(0, start + distance * easeInOutCubic(progress));
      if (progress < 1) window.requestAnimationFrame(frame);
    }

    window.requestAnimationFrame(frame);
  }

  function initSmoothScroll() {
    document.addEventListener('click', function (event) {
      var link = event.target.closest('a[href^="#"]');
      if (!link) return;

      var id = link.getAttribute('href').slice(1);
      var target = id ? document.getElementById(id) : null;
      if (!target) return;

      event.preventDefault();
      // 24px of breathing room, matching `scroll-margin-top` in the CSS.
      var top = Math.max(target.getBoundingClientRect().top + window.scrollY - 24, 0);

      if (reduceMotion.matches) {
        window.scrollTo(0, top);
      } else {
        glideTo(top);
      }

      // Keep the URL and the keyboard focus in step with the jump.
      history.replaceState(null, '', '#' + id);
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });
  }

  // ------------------------------------------------------------ hero drift

  function initHeroDrift() {
    var image = document.querySelector('.hero-img');
    if (!image || reduceMotion.matches) return;

    var pending = false;

    function update() {
      pending = false;
      // A few pixels of lag behind the page — transform only, so it composites.
      var shift = Math.min(window.scrollY * 0.05, 26);
      image.style.transform = 'translate3d(0, ' + shift.toFixed(2) + 'px, 0)';
    }

    window.addEventListener('scroll', function () {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(update);
    }, { passive: true });
  }

  // -------------------------------------------------------------- bootstrap

  function init() {
    initLanguage();
    initReveal();
    initSmoothScroll();
    initHeroDrift();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
