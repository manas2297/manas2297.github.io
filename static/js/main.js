document.addEventListener('DOMContentLoaded', () => {
    const menuBtn = document.getElementById('menu-btn');
    const siteNav = document.getElementById('site-nav');
    const navOverlay = document.getElementById('nav-overlay');
    const siteHeader = document.getElementById('site-header');
    const headerShell = document.getElementById('site-header-shell');

    const closeMenu = () => {
        if (!siteNav || !menuBtn) return;
        siteNav.classList.remove('is-open');
        navOverlay?.classList.remove('is-active');
        menuBtn.setAttribute('aria-expanded', 'false');
    };

    const toggleMenu = () => {
        if (!siteNav || !menuBtn) return;
        const isOpen = siteNav.classList.toggle('is-open');
        navOverlay?.classList.toggle('is-active', isOpen);
        menuBtn.setAttribute('aria-expanded', String(isOpen));
    };

    if (menuBtn && siteNav) {
        menuBtn.addEventListener('click', toggleMenu);
        navOverlay?.addEventListener('click', closeMenu);
        siteNav.querySelectorAll('.site-header__link').forEach((link) => {
            link.addEventListener('click', closeMenu);
        });
    }

    const updateHeaderLayout = () => {
        if (!headerShell) return;
        document.documentElement.style.setProperty('--header-total-height', `${headerShell.offsetHeight}px`);
    };

    const onScrollHeader = () => {
        const scrolled = window.scrollY > 56;
        siteHeader?.classList.toggle('is-compact', scrolled);
        headerShell?.classList.toggle('is-scrolled', scrolled);
        updateHeaderLayout();
    };

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const easeOut = [0.16, 1, 0.3, 1];
    const inViewDefaults = { once: true, margin: '-60px 0px -40px 0px' };

    const markScrollTargets = () => {
        if (reducedMotion) return;

        document.querySelectorAll('.section-header .eyebrow, .section-header .section-title, .section-header .section-lede').forEach((el) => {
            el.classList.add('scroll-hidden');
        });

        document.querySelectorAll('.proj-card').forEach((el) => el.classList.add('scroll-hidden', 'scroll-scale'));
        document.querySelectorAll('.journey-item').forEach((el) => el.classList.add('scroll-hidden', 'scroll-from-left'));
        document.querySelectorAll('.expertise__title, .expertise__tags li').forEach((el) => el.classList.add('scroll-hidden'));
        document.querySelectorAll('.about__grid > *').forEach((el) => el.classList.add('scroll-hidden'));
        document.querySelectorAll('.contact__panel').forEach((el) => el.classList.add('scroll-hidden', 'scroll-scale'));
        document.querySelectorAll('.contact__header > *, .contact__actions .btn, .contact__note').forEach((el) => el.classList.add('scroll-hidden'));
        document.querySelectorAll('.blog-card').forEach((el) => el.classList.add('scroll-hidden'));
        document.querySelectorAll('.site-footer').forEach((el) => el.classList.add('scroll-hidden'));
        document.querySelectorAll('.scroll-reveal').forEach((el) => el.classList.add('scroll-hidden'));
    };

    markScrollTargets();

    const revealAll = () => {
        document.querySelectorAll('.scroll-hidden').forEach((el) => {
            el.classList.remove('scroll-hidden', 'scroll-from-left', 'scroll-scale');
            el.style.opacity = '';
            el.style.transform = '';
        });
        document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-revealed'));
    };

    if (reducedMotion) {
        revealAll();
    } else if (window.Motion) {
        const { animate, inView, stagger, spring } = window.Motion;

        const heroSequence =
            '.hero__availability, .hero__title, .hero__headline, .hero__lede, .hero__proof li, .hero__actions, .hero__social a';

        if (document.querySelector('.hero')) {
            animate(
                heroSequence,
                { opacity: [0, 1], y: [22, 0] },
                { duration: 0.65, delay: stagger(0.07, { start: 0.12 }), easing: easeOut }
            );

            animate(
                '.hero__portrait',
                { opacity: [0, 1], scale: [0.94, 1], x: [28, 0] },
                { duration: 0.85, delay: 0.18, easing: easeOut }
            );
        }

        const revealOnScroll = (selector, keyframes, options = {}) => {
            document.querySelectorAll(selector).forEach((el) => {
                inView(
                    el,
                    () => {
                        animate(el, keyframes, { duration: 0.65, easing: easeOut, ...options });
                        el.classList.remove('scroll-hidden', 'scroll-from-left', 'scroll-scale');
                    },
                    inViewDefaults
                );
            });
        };

        inView(
            '.section-header',
            ({ target }) => {
                const parts = target.querySelectorAll('.eyebrow, .section-title, .section-lede');
                if (!parts.length) return;
                animate(
                    parts,
                    { opacity: [0, 1], y: [20, 0] },
                    { duration: 0.6, delay: stagger(0.1), easing: easeOut }
                );
                parts.forEach((part) => part.classList.remove('scroll-hidden'));
            },
            { ...inViewDefaults, amount: 0.35 }
        );

        inView(
            '.showcase-grid',
            ({ target }) => {
                const cards = target.querySelectorAll('.proj-card');
                const anim = animate(
                    cards,
                    { opacity: [0, 1], y: [36, 0], scale: [0.96, 1] },
                    { duration: 0.65, delay: stagger(0.12), easing: easeOut }
                );
                anim.finished.then(() => {
                    cards.forEach((card) => {
                        card.style.transform = '';
                    });
                });
                cards.forEach((card) => card.classList.remove('scroll-hidden', 'scroll-scale'));
            },
            { ...inViewDefaults, amount: 0.15 }
        );

        inView(
            '.journey__list',
            ({ target }) => {
                const items = target.querySelectorAll('.journey-item');
                animate(
                    items,
                    { opacity: [0, 1], x: [-24, 0] },
                    { duration: 0.6, delay: stagger(0.15), easing: easeOut }
                );
                items.forEach((item) => item.classList.remove('scroll-hidden', 'scroll-from-left'));
            },
            { ...inViewDefaults, amount: 0.2 }
        );

        inView(
            '.expertise',
            ({ target }) => {
                const title = target.querySelector('.expertise__title');
                const tags = target.querySelectorAll('.expertise__tags li');
                if (title) {
                    animate(title, { opacity: [0, 1], y: [16, 0] }, { duration: 0.5, easing: easeOut });
                    title.classList.remove('scroll-hidden');
                }
                animate(
                    tags,
                    { opacity: [0, 1], scale: [0.86, 1], y: [10, 0] },
                    { duration: 0.45, delay: stagger(0.05, { start: 0.08 }), easing: easeOut }
                );
                tags.forEach((tag) => tag.classList.remove('scroll-hidden'));
            },
            { ...inViewDefaults, amount: 0.25 }
        );

        inView(
            '.about__grid',
            ({ target }) => {
                const blocks = target.children;
                animate(
                    blocks,
                    { opacity: [0, 1], y: [28, 0] },
                    { duration: 0.65, delay: stagger(0.14), easing: easeOut }
                );
                Array.from(blocks).forEach((block) => block.classList.remove('scroll-hidden'));
            },
            { ...inViewDefaults, amount: 0.2 }
        );

        inView(
            '.contact__panel',
            ({ target }) => {
                animate(
                    target,
                    { opacity: [0, 1], y: [32, 0], scale: [0.96, 1] },
                    { duration: 0.7, easing: easeOut }
                );
                target.classList.remove('scroll-hidden', 'scroll-scale');

                const inner = target.querySelectorAll('.contact__header > *, .contact__actions .btn, .contact__note');
                animate(
                    inner,
                    { opacity: [0, 1], y: [16, 0] },
                    { duration: 0.55, delay: stagger(0.08, { start: 0.12 }), easing: easeOut }
                );
                inner.forEach((el) => el.classList.remove('scroll-hidden'));
            },
            { ...inViewDefaults, amount: 0.25 }
        );

        inView(
            '.blog-grid',
            ({ target }) => {
                const cards = target.querySelectorAll('.blog-card');
                animate(
                    cards,
                    { opacity: [0, 1], y: [28, 0] },
                    { duration: 0.6, delay: stagger(0.11), easing: easeOut }
                );
                cards.forEach((card) => card.classList.remove('scroll-hidden'));
            },
            { ...inViewDefaults, amount: 0.15 }
        );

        revealOnScroll('.scroll-reveal', { opacity: [0, 1], y: [32, 0] });

        inView(
            '.site-footer',
            ({ target }) => {
                animate(target, { opacity: [0, 1], y: [20, 0] }, { duration: 0.55, easing: easeOut });
                target.classList.remove('scroll-hidden');
            },
            { ...inViewDefaults, amount: 0.4 }
        );

        document.querySelectorAll('.btn--primary, .site-header__cta').forEach((btn) => {
            btn.addEventListener('mouseenter', () => {
                animate(btn, { scale: 1.04 }, { easing: spring({ stiffness: 480, damping: 28 }) });
            });
            btn.addEventListener('mouseleave', () => {
                animate(btn, { scale: 1 }, { easing: spring({ stiffness: 480, damping: 28 }) });
            });
        });
    } else {
        revealAll();
    }

    const navLinks = document.querySelectorAll('.site-header__link');
    const sections = document.querySelectorAll('section[id]');

    const setActiveNav = () => {
        const scrollY = window.scrollY + (siteHeader?.offsetHeight || 80) + 40;
        sections.forEach((section) => {
            const top = section.offsetTop;
            const height = section.offsetHeight;
            const id = section.getAttribute('id');
            if (scrollY >= top && scrollY < top + height) {
                navLinks.forEach((link) => {
                    link.classList.remove('is-active');
                    const href = link.getAttribute('href') || '';
                    if (href.endsWith(`#${id}`)) {
                        link.classList.add('is-active');
                    }
                });
            }
        });
    };

    let scrollTicking = false;
    const handleScroll = () => {
        if (scrollTicking) return;
        scrollTicking = true;
        requestAnimationFrame(() => {
            onScrollHeader();
            setActiveNav();
            scrollTicking = false;
        });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', updateHeaderLayout, { passive: true });

    onScrollHeader();
    setActiveNav();
    updateHeaderLayout();
});
