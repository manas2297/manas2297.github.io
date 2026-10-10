// Scroll-driven depth for the home page:
// - a request-path spine that draws itself from "GET /" down to "200 OK",
// - the experience rail filling role by role,
// - perspective tilt on cards as they enter (plus pointer tilt on project cards),
// - the hero architecture stack separating as you scroll away from it.
(() => {
    const root = document.documentElement;
    const main = document.querySelector('.main');
    if (!main) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clamp = (v, min = 0, max = 1) => Math.min(Math.max(v, min), max);
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const SVG = 'http://www.w3.org/2000/svg';

    // ── Spine ──
    const sections = [...main.querySelectorAll('section[data-route]')];
    const svg = document.createElementNS(SVG, 'svg');
    svg.classList.add('spine');
    svg.setAttribute('aria-hidden', 'true');
    const track = document.createElementNS(SVG, 'path');
    track.classList.add('spine__track');
    const path = document.createElementNS(SVG, 'path');
    path.classList.add('spine__path');
    const halo = document.createElementNS(SVG, 'circle');
    halo.classList.add('spine__halo');
    halo.setAttribute('r', '9');
    const head = document.createElementNS(SVG, 'circle');
    head.classList.add('spine__head');
    head.setAttribute('r', '4');
    svg.append(track, path);
    const stops = sections.map((section) => {
        const node = document.createElementNS(SVG, 'circle');
        node.classList.add('spine__node');
        node.setAttribute('r', '6');
        const label = document.createElementNS(SVG, 'text');
        label.classList.add('spine__label');
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('dominant-baseline', 'middle');
        label.textContent = section.dataset.route;
        svg.append(node, label);
        return { section, node, label, y: 0 };
    });
    svg.append(halo, head);
    main.prepend(svg);

    let length = 0;
    let samples = []; // [{ y, len }] along the path, y increasing
    let showLabels = true;

    const anchorOf = (section) => section.querySelector('.section-header, .contact__header, .hero__title') || section;

    const layoutSpine = () => {
        const mainRect = main.getBoundingClientRect();
        const gutter = mainRect.left;

        let x;
        root.classList.remove('spine-compact');
        if (gutter >= 170) {
            x = -40;
            showLabels = true;
        } else if (gutter >= 48) {
            x = -Math.min(32, gutter / 2);
            showLabels = false;
        } else {
            root.classList.add('spine-compact');
            x = 12;
            showLabels = false;
        }
        const amp = gutter >= 170 ? 46 : gutter >= 48 ? 20 : 5;

        stops.forEach((stop) => {
            const r = anchorOf(stop.section).getBoundingClientRect();
            stop.y = r.top - mainRect.top + 14;
            stop.node.setAttribute('cx', x);
            stop.node.setAttribute('cy', stop.y);
            stop.label.setAttribute('x', x - 16);
            stop.label.setAttribute('y', stop.y);
            stop.label.style.display = showLabels ? '' : 'none';
        });

        // Gentle S-curves between consecutive stops.
        let d = `M ${x} ${stops[0].y}`;
        for (let i = 1; i < stops.length; i++) {
            const y0 = stops[i - 1].y;
            const y1 = stops[i].y;
            const dy = y1 - y0;
            const bend = i % 2 ? amp : -amp;
            d += ` C ${x + bend} ${y0 + dy * 0.35}, ${x - bend} ${y0 + dy * 0.65}, ${x} ${y1}`;
        }
        track.setAttribute('d', d);
        path.setAttribute('d', d);

        length = path.getTotalLength();
        samples = [];
        const n = 240;
        for (let i = 0; i <= n; i++) {
            const len = (length * i) / n;
            samples.push({ y: path.getPointAtLength(len).y, len });
        }
        path.style.strokeDasharray = `${length} ${length}`;
    };

    const lengthAtY = (y) => {
        if (y <= samples[0].y) return 0;
        for (let i = 1; i < samples.length; i++) {
            if (samples[i].y >= y) {
                const a = samples[i - 1];
                const b = samples[i];
                const t = (y - a.y) / Math.max(b.y - a.y, 0.001);
                return a.len + (b.len - a.len) * t;
            }
        }
        return length;
    };

    // ── Experience rail ──
    const journey = main.querySelector('.journey__list');
    const roles = journey ? [...journey.querySelectorAll('.journey-item')] : [];

    // ── Perspective targets (project cards are animated by works-motion.js) ──
    const tilted = [...main.querySelectorAll('.journey-item, .about__copy, .about__aside, .expertise, .contact__panel')].map((el) => ({ el }));

    // ── Hero stack ──
    const stackScene = document.querySelector('.stack__scene');
    const hero = document.querySelector('.hero');
    let tiltX = 0;
    let tiltZ = 0;
    if (hero && stackScene && !reducedMotion) {
        hero.addEventListener('pointermove', (e) => {
            tiltZ = ((e.clientX / window.innerWidth) - 0.5) * 10;
            tiltX = ((e.clientY / window.innerHeight) - 0.5) * -8;
            schedule();
        });
    }

    const update = () => {
        const vh = window.innerHeight;
        const mainTop = main.getBoundingClientRect().top;

        // Spine: draw to the point 60% down the viewport.
        const drawY = reducedMotion ? Infinity : vh * 0.6 - mainTop;
        const drawn = Math.min(lengthAtY(drawY), length);
        path.style.strokeDashoffset = `${length - drawn}`;
        const p = path.getPointAtLength(drawn);
        head.setAttribute('cx', p.x);
        head.setAttribute('cy', p.y);
        halo.setAttribute('cx', p.x);
        halo.setAttribute('cy', p.y);
        stops.forEach((stop) => {
            const reached = stop.y <= p.y + 1;
            stop.node.classList.toggle('is-reached', reached);
            stop.label.classList.toggle('is-reached', reached);
        });

        // Experience rail.
        if (journey) {
            const r = journey.getBoundingClientRect();
            const fill = reducedMotion ? 1 : clamp((vh * 0.6 - r.top) / r.height);
            journey.style.setProperty('--fill', fill.toFixed(4));
            const fillY = r.top + 8 + (r.height - 16) * fill;
            roles.forEach((role) => {
                role.classList.toggle('is-reached', role.getBoundingClientRect().top + 12 <= fillY);
            });
        }

        // Cards lean back until they are well inside the viewport.
        if (!reducedMotion) {
            tilted.forEach((t) => {
                const r = t.el.getBoundingClientRect();
                const enter = ease(clamp((vh - r.top) / (vh * 0.4)));
                const rx = (1 - enter) * 16;
                const ty = (1 - enter) * 48;
                t.el.style.transform = `perspective(1100px) translateY(${ty.toFixed(1)}px) rotateX(${rx.toFixed(2)}deg)`;
                t.el.style.opacity = (0.4 + 0.6 * enter).toFixed(3);
            });
        }

        // Stack separates as the hero scrolls away.
        if (stackScene && !reducedMotion) {
            const open = clamp(window.scrollY / (vh * 0.7));
            const base = window.innerWidth <= 900 ? 50 : 64;
            stackScene.style.setProperty('--gap', `${(base + open * base * 0.6).toFixed(1)}px`);
            stackScene.style.setProperty('--tilt-x', `${(tiltX + open * -10).toFixed(2)}deg`);
            stackScene.style.setProperty('--tilt-z', `${(tiltZ + open * 14).toFixed(2)}deg`);
        }
    };

    let queued = false;
    function schedule() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            update();
        });
    }

    const relayout = () => {
        layoutSpine();
        update();
    };

    relayout();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', relayout, { passive: true });
    window.addEventListener('load', relayout);
    if ('ResizeObserver' in window) new ResizeObserver(relayout).observe(main);
})();
