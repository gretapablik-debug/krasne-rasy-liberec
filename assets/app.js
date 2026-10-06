/* Krásné řasy Liberec — reveal animations and smooth scrolling.
 *
 * Each language is its own static page built by build.mjs, so nothing here
 * touches copy: the switcher is plain links.
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

  var REVEAL_SELECTOR = [
    '.hero-copy > *', '.hero-frame',
    '.head-center > *', '.section > h2', '.wrap-820 > h2',
    '.price-row', '.extras', '.free',
    '.card', '.about__media', '.about__copy > *',
    '.step', '.work', '.review', '.faq-item',
    '.contact__copy > *', '.contact-link',
    '.footer'
  ].join(',');

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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
