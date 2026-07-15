/* global gsap */
/*
 * Shared GSAP glass motion.
 * All effects are optional progressive enhancement and honor reduced motion.
 */
(function () {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const engine = window.gsap;
  const glassSelector = [
    '.term', '.card', '.step', '.plan', '.strip', '.cta-band', '.panel',
    '.modal', '.filter-card', '.analysis-card', '.output-card', '.quality-panel'
  ].join(',');

  function registerGlassSurfaces(root) {
    (root || document).querySelectorAll(glassSelector).forEach((surface) => {
      if (surface.dataset.glassReady === 'true') return;
      surface.dataset.glassReady = 'true';

      if (reduced || !engine || !window.matchMedia('(pointer:fine)').matches) return;

      const rotateX = engine.quickTo(surface, 'rotationX', { duration: 0.45, ease: 'power3.out' });
      const rotateY = engine.quickTo(surface, 'rotationY', { duration: 0.45, ease: 'power3.out' });

      surface.addEventListener('pointermove', (event) => {
        const rect = surface.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
        surface.style.setProperty('--shine-x', `${(x * 100).toFixed(1)}%`);
        surface.style.setProperty('--shine-y', `${(y * 100).toFixed(1)}%`);
        rotateX((0.5 - y) * 1.7);
        rotateY((x - 0.5) * 1.7);
      });

      surface.addEventListener('pointerleave', () => {
        surface.style.setProperty('--shine-x', '24%');
        surface.style.setProperty('--shine-y', '12%');
        rotateX(0);
        rotateY(0);
      });
    });
  }

  function animateRevealElements() {
    const targets = Array.from(document.querySelectorAll('.reveal'));
    if (!targets.length) return;

    if (reduced || !engine || !('IntersectionObserver' in window)) {
      targets.forEach((target) => target.classList.add('in'));
      return;
    }

    targets.forEach((target) => {
      target.classList.add('in');
      engine.set(target, { autoAlpha: 0, y: 24 });
    });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        engine.to(entry.target, {
          autoAlpha: 1,
          y: 0,
          duration: 0.82,
          ease: 'power3.out',
          clearProps: 'transform,opacity,visibility'
        });
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });

    targets.forEach((target) => observer.observe(target));
  }

  function animatePageEntry() {
    if (reduced || !engine) return;
    const header = document.querySelector('.nav, .header');
    const logo = document.querySelector('.brand-logo');
    const heroItems = document.querySelectorAll('.hero > div:first-child > *');

    if (header) engine.from(header, { autoAlpha: 0, y: -12, duration: 0.65, ease: 'power3.out' });
    if (logo) engine.from(logo, { autoAlpha: 0, x: -14, duration: 0.8, ease: 'power3.out', delay: 0.08 });
    if (heroItems.length) {
      engine.from(heroItems, { autoAlpha: 0, y: 22, duration: 0.72, stagger: 0.075, ease: 'power3.out', delay: 0.12 });
    }
  }

  function animateActiveStep(root) {
    registerGlassSurfaces(root || document);
    if (reduced || !engine) return;
    const scope = root || document;
    const panels = scope.querySelectorAll('.panel:not(.hidden), .section-head, .view:not(.hidden) > *');
    if (!panels.length) return;
    engine.fromTo(panels,
      { autoAlpha: 0, y: 14 },
      { autoAlpha: 1, y: 0, duration: 0.55, stagger: 0.045, ease: 'power3.out', clearProps: 'transform,opacity,visibility' }
    );
  }

  function init() {
    registerGlassSurfaces(document);
    animateRevealElements();
    animatePageEntry();
    document.addEventListener('bndr:stepchange', (event) => animateActiveStep(event.detail?.root || document));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
