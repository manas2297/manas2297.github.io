// Case-study deck, animated with Motion (the vanilla-JS engine behind Framer Motion).
// - Scroll: each card pins under the header; as the next card slides over it,
//   the covered card shrinks, tips back and dims.
// - Entrance: the image unmasks and the copy staggers in when a card arrives.
// - Hover: the card turns toward the pointer on a spring.
(() => {
    const deck = document.getElementById('deck');
    if (!deck) return;

    const slots = [...deck.querySelectorAll('.deck__slot')];
    slots.forEach((slot, i) => slot.style.setProperty('--i', i));

    const M = window.Motion;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!M || reducedMotion) return;
    const { animate, scroll, inView, spring, stagger } = M;
    const easeOut = [0.16, 1, 0.3, 1];

    const cards = slots.map((slot) => {
        const card = slot.querySelector('.proj-card');
        const shade = document.createElement('span');
        shade.className = 'proj-card__shade';
        card.append(shade);
        return {
            slot,
            card,
            shade,
            img: card.querySelector('.proj-card__img'),
            copy: card.querySelectorAll('.proj-card__meta, .proj-card__title, .proj-card__desc, .proj-card__link'),
        };
    });

    // ── Stacking, linked to scroll ──
    let stops = [];
    const build = () => {
        stops.forEach((stop) => stop());
        stops = [];

        const vh = window.innerHeight;
        const deckTop = deck.getBoundingClientRect().top + window.scrollY;
        const range = Math.max(deck.offsetHeight, 1);
        const start = deckTop - vh; // progress 0: deck top at the bottom of the viewport

        // Static (unstuck) top of each slot, from heights and margins in normal flow.
        let y = deckTop;
        const tops = cards.map(({ slot }) => {
            const top = y;
            y += slot.offsetHeight + parseFloat(getComputedStyle(slot).marginBottom);
            return top;
        });
        const clamp = (v) => Math.min(Math.max(v, 0), 1);

        cards.slice(0, -1).forEach(({ card, shade }, i) => {
            const nextTop = tops[i + 1];
            const nextStick = parseFloat(getComputedStyle(cards[i + 1].slot).top) || 0;
            const a = clamp((nextTop - vh - start) / range);
            const b = Math.max(clamp((nextTop - nextStick - start) / range), a + 0.001);
            const offset = [0, a, b, 1];
            stops.push(
                scroll(animate(card, { scale: [1, 1, 0.94, 0.94], rotateX: [0, 0, -8, -8] }, { offset, easing: 'linear' }), {
                    target: deck,
                    offset: ['start end', 'end end'],
                }),
                scroll(animate(shade, { opacity: [0, 0, 0.55, 0.55] }, { offset, easing: 'linear' }), {
                    target: deck,
                    offset: ['start end', 'end end'],
                })
            );
        });
    };

    let resizeTimer;
    const rebuild = () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(build, 150);
    };
    build();
    window.addEventListener('resize', rebuild, { passive: true });
    window.addEventListener('load', rebuild);

    // ── Entrance ──
    cards.forEach(({ slot, img, copy }) => {
        if (img) img.style.clipPath = 'inset(12% 12% 12% 12% round 16px)';
        copy.forEach((el) => (el.style.opacity = '0'));
        inView(
            slot,
            () => {
                if (img) {
                    animate(img, { clipPath: 'inset(0% 0% 0% 0% round 0px)', scale: [1.15, 1] }, { duration: 1, easing: easeOut });
                }
                animate(copy, { opacity: [0, 1], y: [18, 0] }, { duration: 0.7, delay: stagger(0.08, { start: 0.15 }), easing: easeOut });
            },
            { amount: 0.25 }
        );
    });

    // ── Hover: turn toward the pointer ──
    const springy = spring({ stiffness: 260, damping: 26 });
    cards.forEach(({ card }) => {
        card.addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'mouse') return;
            const r = card.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width - 0.5;
            animate(card, { rotateY: px * 6, y: -4 }, { easing: springy });
        });
        card.addEventListener('pointerleave', () => {
            animate(card, { rotateY: 0, y: 0 }, { easing: springy });
        });
    });
})();
