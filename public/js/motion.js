/* ═══════════════════════════════════════════════════════════
   STOREU Motion — scroll reveal, hero particles, micro-interactions
   - CSS-first where possible; JS only for orchestration
   - Honors prefers-reduced-motion (reveals instantly, no particles)
   - Content stays visible if this script fails (JS-gated classes)
   ═══════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.documentElement.classList.add('js-anim');

    /* ── Staggered scroll reveal ── */
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    function initReveals(root) {
        (root || document).querySelectorAll('.reveal:not(.revealed)').forEach((el) => {
            const d = el.getAttribute('data-reveal-delay');
            if (d !== null) el.style.setProperty('--rd', d);
            if (reduceMotion) {
                el.classList.add('revealed');
            } else {
                revealObserver.observe(el);
            }
        });
    }

    /* Stagger a freshly-rendered product grid */
    function revealGrid(container) {
        if (!container || reduceMotion) return;
        const cards = container.querySelectorAll('.p-card, .glass-card.product-card');
        cards.forEach((card, i) => {
            card.style.setProperty('--rd', Math.min(i, 11));
            card.classList.add('reveal');
            // force reflow so the transition runs after insertion
            void card.offsetWidth;
            revealObserver.observe(card);
        });
    }

    /* ── Hero intro: trigger title line reveal on load ── */
    function initHeroIntro() {
        const title = document.querySelector('.hero-title');
        if (!title) return;
        title.querySelectorAll('.reveal-line').forEach((line, i) => {
            line.style.setProperty('--rl', i);
        });
        requestAnimationFrame(() => requestAnimationFrame(() => {
            title.classList.add('inview');
        }));
    }

    /* ── Hero canvas particles: slow drifting dots, mouse parallax ── */
    function initHeroParticles() {
        const canvas = document.getElementById('hero-canvas');
        if (!canvas || reduceMotion) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let w, h, parts = [], raf = null, mx = 0, my = 0, visible = true;
        const COUNT = 70;

        function resize() {
            const r = canvas.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            w = r.width; h = r.height;
            canvas.width = w * dpr; canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function seed() {
            parts = [];
            for (let i = 0; i < COUNT; i++) {
                parts.push({
                    x: Math.random() * w,
                    y: Math.random() * h,
                    r: Math.random() * 1.8 + 0.5,
                    vx: (Math.random() - 0.5) * 0.22,
                    vy: (Math.random() - 0.5) * 0.22,
                    a: Math.random() * 0.5 + 0.12,
                    hue: Math.random() < 0.6 ? '129,140,248' : '34,211,238',
                    depth: Math.random() * 0.8 + 0.2,
                });
            }
        }

        function tick() {
            if (!visible) { raf = null; return; }
            ctx.clearRect(0, 0, w, h);
            for (const p of parts) {
                p.x += p.vx; p.y += p.vy;
                if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
                if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10;
                const px = p.x + mx * 24 * p.depth;
                const py = p.y + my * 24 * p.depth;
                ctx.beginPath();
                ctx.arc(px, py, p.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${p.hue},${p.a})`;
                ctx.fill();
            }
            raf = requestAnimationFrame(tick);
        }

        function start() { if (!raf && visible) { raf = requestAnimationFrame(tick); } }

        // Pause when hero is off-screen (perf) — cheap visibility check
        const hero = document.getElementById('hero');
        if ('IntersectionObserver' in window && hero) {
            new IntersectionObserver((es) => {
                visible = es[0].isIntersecting;
                if (visible) start();
            }).observe(hero);
        }

        window.addEventListener('resize', () => { resize(); seed(); }, { passive: true });
        window.addEventListener('pointermove', (e) => {
            mx = (e.clientX / window.innerWidth - 0.5);
            my = (e.clientY / window.innerHeight - 0.5);
        }, { passive: true });

        resize(); seed(); start();
    }

    /* ── Back to top + scroll hint ── */
    function initScrollChrome() {
        const btt = document.getElementById('back-to-top');
        const hint = document.querySelector('.scroll-hint');
        let ticking = false;
        function onScroll() {
            const y = window.scrollY;
            if (btt) {
                if (btt.hasAttribute('hidden')) btt.removeAttribute('hidden');
                btt.classList.toggle('show', y > 640);
            }
            if (hint) hint.style.opacity = y > 120 ? '0' : '1';
            ticking = false;
        }
        window.addEventListener('scroll', () => {
            if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
        }, { passive: true });
        if (btt) {
            btt.addEventListener('click', () => {
                window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
            });
        }
        onScroll();
    }

    /* ── Mobile menu: aria state ── */
    function initMobileMenuA11y() {
        const toggle = document.getElementById('mobile-toggle');
        const menu = document.getElementById('navbar-nav');
        if (!toggle || !menu) return;
        toggle.addEventListener('click', () => {
            const open = menu.classList.contains('show');
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            toggle.setAttribute('aria-label', open ? 'Tutup menu navigasi' : 'Buka menu navigasi');
        });
    }

    /* ── Public API ── */
    window.StoreuMotion = { revealGrid, initReveals, reduceMotion };

    document.addEventListener('DOMContentLoaded', () => {
        initReveals(document);
        initHeroIntro();
        initHeroParticles();
        initScrollChrome();
        initMobileMenuA11y();
    });
})();
