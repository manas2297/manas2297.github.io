(function () {
    const CONTENT_URL = 'content.json';

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function renderPortfolio(d) {
        document.title = d.meta.title;
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) metaDesc.setAttribute('content', d.meta.description);

        document.getElementById('brand-sidebar-title').textContent = d.brand.sidebarTitle;
        document.getElementById('brand-sidebar-meta').textContent = d.brand.sidebarSubtitle;
        document.getElementById('brand-watermark').textContent = d.brand.verticalWatermark;
        document.getElementById('brand-est').textContent = d.brand.established;
        document.getElementById('top-bar-tagline').textContent = d.brand.topBarTagline;
        document.getElementById('menu-btn-label').textContent = d.menuButtonLabel || 'Menu';

        const navEl = document.getElementById('sidebar-nav');
        navEl.innerHTML = '';
        d.nav.forEach((item, i) => {
            const a = document.createElement('a');
            a.href = `#${item.section}`;
            a.className = 'sidebar-link';
            if (i === 0) a.classList.add('is-active');
            a.dataset.section = item.section;
            const iconClass = item.icon.startsWith('fa-') ? item.icon : `fa-${item.icon}`;
            a.innerHTML = `<i class="fa-solid ${iconClass}" aria-hidden="true"></i><span>${escapeHtml(item.label)}</span>`;
            navEl.appendChild(a);
        });

        const heroCopy = document.getElementById('hero-copy');
        heroCopy.innerHTML = '';
        const eyebrow = document.createElement('p');
        eyebrow.className = 'eyebrow';
        eyebrow.textContent = d.hero.eyebrow;
        heroCopy.appendChild(eyebrow);

        const h1 = document.createElement('h1');
        h1.className = 'hero__title';
        d.hero.titleLines.forEach((lineParts, lineIdx) => {
            if (lineIdx > 0) h1.appendChild(document.createElement('br'));
            lineParts.forEach((part) => {
                const span = document.createElement('span');
                if (part.accent) span.className = 'hero__accent';
                span.textContent = part.text;
                h1.appendChild(span);
            });
        });
        heroCopy.appendChild(h1);

        const lede = document.createElement('p');
        lede.className = 'hero__lede';
        lede.textContent = d.hero.lede;
        heroCopy.appendChild(lede);

        const cta = document.createElement('a');
        cta.href = d.hero.ctaHref;
        cta.className = 'btn-coral';
        cta.textContent = d.hero.ctaLabel;
        heroCopy.appendChild(cta);

        const heroFrame = document.getElementById('hero-frame');
        heroFrame.innerHTML = '';
        heroFrame.classList.remove('hero__frame--empty');
        if (d.hero.portrait && d.hero.portrait.src) {
            const img = document.createElement('img');
            img.src = d.hero.portrait.src;
            img.alt = d.hero.portrait.alt != null ? d.hero.portrait.alt : '';
            img.className = 'hero__img';
            img.width = 520;
            img.height = 700;
            img.loading = 'eager';
            img.onerror = () => {
                img.remove();
                heroFrame.classList.add('hero__frame--empty');
            };
            heroFrame.appendChild(img);
        } else {
            heroFrame.classList.add('hero__frame--empty');
        }

        const philH = document.getElementById('philosophy-heading');
        philH.innerHTML = '';
        d.philosophy.headingParts.forEach((part) => {
            if (part.accent) {
                const span = document.createElement('span');
                span.className = 'section-accent';
                span.textContent = part.text;
                philH.appendChild(span);
            } else {
                philH.appendChild(document.createTextNode(part.text));
            }
        });

        const philBody = document.getElementById('philosophy-body');
        philBody.innerHTML = '';
        const paras = d.philosophy.paragraphs || [];
        if (paras[0]) {
            const p0 = document.createElement('p');
            p0.className = 'prose';
            p0.textContent = paras[0];
            philBody.appendChild(p0);
        }
        if (d.philosophy.pullquote) {
            const bq = document.createElement('blockquote');
            bq.className = 'pullquote';
            bq.textContent = d.philosophy.pullquote;
            philBody.appendChild(bq);
        }
        if (paras[1]) {
            const p1 = document.createElement('p');
            p1.className = 'prose';
            p1.textContent = paras[1];
            philBody.appendChild(p1);
        }

        const svcGrid = document.getElementById('services');
        svcGrid.innerHTML = '';
        d.philosophy.services.forEach((svc) => {
            const art = document.createElement('article');
            art.className = 'service-card';
            art.innerHTML = `<span class="service-card__num">${escapeHtml(svc.num)}</span><h3 class="service-card__title">${escapeHtml(svc.title)}</h3><p class="service-card__desc">${escapeHtml(svc.description)}</p>`;
            svcGrid.appendChild(art);
        });

        const track = document.getElementById('marquee-track');
        track.innerHTML = '';
        let items = [...(d.marquee.items || [])];
        if (d.marquee.repeatSet) items = [...items, ...d.marquee.items];
        items.forEach((mi) => {
            const span = document.createElement('span');
            span.className = 'marquee__item' + (mi.accent ? ' marquee__item--accent' : '');
            span.textContent = mi.text;
            track.appendChild(span);
        });

        document.getElementById('showcase-wm-primary').textContent = d.showcase.watermarks.primary;
        document.getElementById('showcase-wm-secondary').textContent = d.showcase.watermarks.secondary;

        const shTitle = document.getElementById('showcase-heading');
        shTitle.innerHTML = '';
        const sl1 = document.createElement('span');
        sl1.className = 'showcase__title-line';
        sl1.textContent = d.showcase.title.line1;
        shTitle.appendChild(sl1);
        const sl2 = document.createElement('span');
        sl2.className = 'showcase__title-line' + (d.showcase.title.line2Accent ? ' showcase__title-line--accent' : '');
        sl2.textContent = d.showcase.title.line2;
        shTitle.appendChild(sl2);

        const filtEl = document.getElementById('showcase-filters');
        filtEl.innerHTML = '';
        d.showcase.filters.forEach((f, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'showcase-filter' + (idx === 0 ? ' is-active' : '');
            btn.dataset.filter = f.id;
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
            btn.textContent = f.label;
            filtEl.appendChild(btn);
        });

        const grid = document.getElementById('showcase-grid');
        grid.innerHTML = '';
        d.showcase.projects.forEach((proj) => {
            const article = document.createElement('article');
            const layout = proj.layout || 'compact';
            article.className = `project-card project-card--${layout} project-card--slot-${proj.slot}`;
            article.dataset.category = proj.category;

            if (layout === 'split') {
                article.innerHTML = `
                    <div class="project-card__split-copy">
                        <h3 class="project-card__title">${escapeHtml(proj.title)}</h3>
                        <a href="${escapeHtml(proj.exploreHref)}" class="project-card__explore">${escapeHtml(proj.exploreLabel)}</a>
                    </div>
                    <div class="project-card__split-visual">
                        <img src="${escapeHtml(proj.portraitImage)}" alt="" width="600" height="800" loading="lazy" class="project-card__portrait">
                    </div>`;
            } else {
                const cta =
                    proj.ctaLabel && proj.ctaHref
                        ? `<a href="${escapeHtml(proj.ctaHref)}" class="project-card__cta">${escapeHtml(proj.ctaLabel)} <span aria-hidden="true">→</span></a>`
                        : '';
                article.innerHTML = `
                    <div class="project-card__media">
                        <img src="${escapeHtml(proj.image)}" alt="" width="900" height="600" loading="lazy">
                    </div>
                    <div class="project-card__body">
                        <h3 class="project-card__title">${escapeHtml(proj.title)}</h3>
                        <p class="project-card__tag">${escapeHtml(proj.tag)}</p>
                        ${cta}
                    </div>`;
            }
            grid.appendChild(article);
        });

        const skillsTitle = document.getElementById('skills-heading');
        skillsTitle.innerHTML = `${escapeHtml(d.skillsHub.title)}<span class="skills-hub__title-strong">${escapeHtml(d.skillsHub.titleAccent)}</span>`;

        const ringsEl = document.getElementById('skill-rings');
        ringsEl.innerHTML = '';
        d.skillsHub.rings.forEach((ring) => {
            const div = document.createElement('div');
            div.className = 'skill-ring';
            div.setAttribute('role', 'listitem');
            div.dataset.ringPercent = String(ring.percent);
            div.innerHTML = `<div class="skill-ring__donut-wrap">
                    <div class="skill-ring__donut" aria-hidden="true"></div>
                    <p class="skill-ring__value"><span class="skill-ring__num">0</span>%</p>
                </div>
                <h3 class="skill-ring__label">${escapeHtml(ring.label)}</h3>
                <p class="skill-ring__sub">${escapeHtml(ring.sub)}</p>`;
            ringsEl.appendChild(div);
        });

        const jHead = document.getElementById('journey-header');
        jHead.innerHTML = `<h3 class="journey__title">${escapeHtml(d.skillsHub.journey.title)}</h3><p class="journey__lede">${escapeHtml(d.skillsHub.journey.lede)}</p>`;

        const jList = document.getElementById('journey-list');
        jList.innerHTML = '';
        d.skillsHub.journey.items.forEach((it) => {
            const li = document.createElement('li');
            li.className = 'journey-item';
            const arrow =
                it.showArrow
                    ? `<span class="journey-item__arrow" aria-hidden="true"><i class="fa-solid fa-arrow-right"></i></span>`
                    : '';
            li.innerHTML = `<div class="journey-item__row">
                    <div class="journey-item__meta">
                        <span class="journey-item__years">${escapeHtml(it.years)}</span>
                        <span class="journey-item__role">${escapeHtml(it.role)}</span>
                        <span class="journey-item__co">${escapeHtml(it.company)}</span>
                    </div>${arrow}
                </div>
                <p class="journey-item__text">${escapeHtml(it.text)}</p>`;
            jList.appendChild(li);
        });

        document.getElementById('credentials-heading').textContent = d.skillsHub.credentialsHeading;
        const credGrid = document.getElementById('credentials-grid');
        credGrid.innerHTML = '';
        d.skillsHub.credentials.forEach((c) => {
            const art = document.createElement('article');
            const feat = c.featured ? ' cred-card--featured' : '';
            const icon = c.icon.startsWith('fa-') ? c.icon : `fa-${c.icon}`;
            const num = c.num ? `<span class="cred-card__num" aria-hidden="true">${escapeHtml(c.num)}</span>` : '';
            art.className = 'cred-card' + feat;
            art.innerHTML = `${num}<i class="fa-solid ${icon} cred-card__icon" aria-hidden="true"></i><h4 class="cred-card__title">${escapeHtml(c.title)}</h4>`;
            credGrid.appendChild(art);
        });

        const statsEl = document.getElementById('skills-stats');
        statsEl.innerHTML = '';
        d.skillsHub.stats.forEach((st) => {
            const div = document.createElement('div');
            div.className = 'skills-stats__item';
            const padAttr = st.pad ? ` data-pad="${st.pad}"` : '';
            const padClass = st.pad ? ' counter--pad' : '';
            div.innerHTML = `<span class="skills-stats__num"><span class="counter${padClass}" data-target="${st.target}"${padAttr}>0</span>${escapeHtml(st.suffix)}</span><span class="skills-stats__label">${escapeHtml(st.label)}</span>`;
            statsEl.appendChild(div);
        });

        document.getElementById('contact-eyebrow').textContent = d.contact.eyebrow;
        document.getElementById('contact-heading').textContent = d.contact.title;

        const direct = document.getElementById('contact-direct');
        direct.innerHTML = '';
        d.contact.direct.forEach((row) => {
            const icon = row.icon.startsWith('fa-') ? row.icon : `fa-${row.icon}`;
            if (row.type === 'email' || row.type === 'phone') {
                const wrap = document.createElement('div');
                wrap.className = 'contact-direct__item';
                wrap.innerHTML = `<span class="contact-direct__icon" aria-hidden="true"><i class="fa-solid ${icon}"></i></span>
                    <div><p class="contact-direct__label">${escapeHtml(row.label)}</p><a href="${escapeHtml(row.href)}" class="contact-direct__value">${escapeHtml(row.value)}</a></div>`;
                direct.appendChild(wrap);
            } else {
                const wrap = document.createElement('div');
                wrap.className = 'contact-direct__item';
                wrap.innerHTML = `<span class="contact-direct__icon" aria-hidden="true"><i class="fa-solid ${icon}"></i></span>
                    <div><p class="contact-direct__label">${escapeHtml(row.label)}</p><p class="contact-direct__value">${escapeHtml(row.value)}</p></div>`;
                direct.appendChild(wrap);
            }
        });
        const av = d.contact.availability;
        const status = document.createElement('div');
        status.className = 'contact-direct__status';
        status.innerHTML = `<div class="contact-direct__status-visual" aria-hidden="true"></div>
            <p class="contact-direct__status-text"><span class="contact-direct__status-key">${escapeHtml(av.prefix)}</span> ${escapeHtml(av.message)}</p>`;
        direct.appendChild(status);

        const formWrap = document.getElementById('contact-form-wrap');
        const fm = d.contact.form;
        let fieldsHtml = '';
        fm.fields.forEach((f) => {
            const ac = f.autocomplete ? ` autocomplete="${escapeHtml(f.autocomplete)}"` : '';
            const ic = f.inputClass ? ` ${f.inputClass}` : '';
            if (f.type === 'textarea') {
                fieldsHtml += `<label class="contact-form__field"><span class="contact-form__label">${escapeHtml(f.label)}</span>
                    <textarea name="${escapeHtml(f.name)}" class="contact-form__input${ic}" rows="${f.rows || 4}" placeholder="${escapeHtml(f.placeholder)}"></textarea></label>`;
            } else {
                fieldsHtml += `<label class="contact-form__field"><span class="contact-form__label">${escapeHtml(f.label)}</span>
                    <input type="${escapeHtml(f.type)}" name="${escapeHtml(f.name)}" class="contact-form__input${ic}" placeholder="${escapeHtml(f.placeholder)}"${ac}></label>`;
            }
        });
        formWrap.innerHTML = `<form class="contact-form" id="contact-form" action="${escapeHtml(fm.action)}" method="${escapeHtml(fm.method)}">
            <span class="contact-form__corner" aria-hidden="true"></span>${fieldsHtml}
            <div class="contact-form__actions">
                <button type="submit" class="contact-form__submit">${escapeHtml(fm.submitLabel)}</button>
                <p class="contact-form__legal">${escapeHtml(fm.legal)}</p>
            </div></form>`;

        const fBrand = document.createElement('span');
        fBrand.className = 'site-footer__brand';
        fBrand.textContent = d.footer.brand;
        const fCopy = document.getElementById('footer-copy');
        fCopy.innerHTML = '';
        fCopy.appendChild(fBrand);
        fCopy.appendChild(document.createTextNode(` · ${d.footer.copyrightLine}`));

        const soc = document.getElementById('footer-social');
        soc.innerHTML = '';
        d.footer.social.forEach((s) => {
            const a = document.createElement('a');
            a.href = s.href;
            a.textContent = s.label;
            soc.appendChild(a);
        });
    }

    function elementTop(el) {
        return el.getBoundingClientRect().top + window.scrollY;
    }

    function setupScrollSpy() {
        let scrollTicking = false;
        window.addEventListener('scroll', () => {
            if (!scrollTicking) {
                scrollTicking = true;
                requestAnimationFrame(() => {
                    updateActiveLink();
                    scrollTicking = false;
                });
            }
        });

        function updateActiveLink() {
            const y = window.scrollY + window.innerHeight * 0.28;
            let current = 'welcome';
            const sidebarLinks = document.querySelectorAll('.sidebar-link');

            const welcome = document.getElementById('welcome');
            const philosophy = document.querySelector('.philosophy-block');
            const works = document.getElementById('works');
            const skills = document.getElementById('skills');
            const contact = document.getElementById('contact');

            const marks = [];
            if (welcome) marks.push({ id: 'welcome', top: elementTop(welcome) });
            if (philosophy) {
                const phTop = elementTop(philosophy);
                const phH = philosophy.offsetHeight;
                marks.push({ id: 'about', top: phTop });
                marks.push({ id: 'services', top: phTop + phH * 0.42 });
            }
            if (works) marks.push({ id: 'works', top: elementTop(works) });
            if (skills) marks.push({ id: 'skills', top: elementTop(skills) });
            if (contact) marks.push({ id: 'contact', top: elementTop(contact) });

            marks.sort((a, b) => a.top - b.top);
            for (const m of marks) {
                if (y >= m.top) current = m.id;
            }

            sidebarLinks.forEach((link) => {
                const sec = link.getAttribute('data-section');
                link.classList.toggle('is-active', sec === current);
            });
        }

        window.addEventListener('resize', () => {
            if (window.matchMedia('(min-width: 901px)').matches) {
                setNavOpen(false, document.getElementById('nav-overlay'), document.getElementById('menu-btn'));
            }
        });

        return updateActiveLink;
    }

    function setNavOpen(open, overlay, menuBtn) {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar || !menuBtn) return;
        sidebar.classList.toggle('is-open', open);
        menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        document.body.classList.toggle('nav-open', open);
        if (overlay) {
            overlay.classList.toggle('is-visible', open);
            overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
        }
    }

    function setupMobileNav(overlay, menuBtn) {
        const sidebar = document.getElementById('sidebar');
        if (menuBtn) {
            menuBtn.addEventListener('click', () => {
                const open = !sidebar.classList.contains('is-open');
                setNavOpen(open, overlay, menuBtn);
            });
        }
        if (overlay) overlay.addEventListener('click', () => setNavOpen(false, overlay, menuBtn));

        document.getElementById('sidebar-nav')?.addEventListener('click', (e) => {
            const a = e.target.closest('a.sidebar-link');
            if (a && window.matchMedia('(max-width: 900px)').matches) {
                setNavOpen(false, overlay, menuBtn);
            }
        });
    }

    function initSkillRings() {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        document.querySelectorAll('.skill-ring').forEach((ring) => {
            const donut = ring.querySelector('.skill-ring__donut');
            const numEl = ring.querySelector('.skill-ring__num');
            const target = parseInt(ring.getAttribute('data-ring-percent') || '0', 10);
            if (!donut || !numEl || Number.isNaN(target)) return;

            const apply = (p, n) => {
                donut.style.setProperty('--p', String(p));
                numEl.textContent = String(n);
            };
            apply(0, 0);

            const run = () => {
                if (reduceMotion) {
                    apply(target, target);
                    return;
                }
                const duration = 1400;
                const t0 = performance.now();
                const tick = (now) => {
                    const t = Math.min(1, (now - t0) / duration);
                    const eased = 1 - (1 - t) ** 3;
                    const p = Math.round(eased * target);
                    apply(p, p);
                    if (t < 1) requestAnimationFrame(tick);
                    else apply(target, target);
                };
                requestAnimationFrame(tick);
            };

            const obs = new IntersectionObserver(
                (entries) => {
                    if (entries[0].isIntersecting) {
                        run();
                        obs.disconnect();
                    }
                },
                { threshold: 0.15 }
            );
            obs.observe(ring);
        });
    }

    function initCounters() {
        const counters = document.querySelectorAll('.counter');
        const speed = 120;
        counters.forEach((counter) => {
            const target = +counter.getAttribute('data-target');
            if (Number.isNaN(target)) return;
            const padAttr = counter.getAttribute('data-pad');
            let progress = 0;

            const step = () => {
                progress = Math.min(target, progress + Math.max(1, target / speed));
                if (padAttr) {
                    counter.textContent = String(Math.floor(progress)).padStart(+padAttr, '0');
                } else {
                    counter.textContent = String(Math.ceil(progress));
                }
                if (progress < target) {
                    setTimeout(step, 20);
                } else {
                    counter.textContent = padAttr ? String(target).padStart(+padAttr, '0') : String(target);
                }
            };

            const observer = new IntersectionObserver(
                (entries) => {
                    if (entries[0].isIntersecting) {
                        progress = 0;
                        counter.textContent = padAttr ? ''.padStart(+padAttr, '0') : '0';
                        step();
                        observer.disconnect();
                    }
                },
                { threshold: 0.35 }
            );
            observer.observe(counter);
        });
    }

    function initReveal() {
        const els = document.querySelectorAll('.reveal');
        if (!els.length) return;

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            els.forEach((el) => el.classList.add('is-revealed'));
            return;
        }

        const obs = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('is-revealed');
                        obs.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.08, rootMargin: '0px 0px -6% 0px' }
        );
        els.forEach((el) => obs.observe(el));
    }

    function initShowcaseFilters() {
        const filterBtns = document.querySelectorAll('.showcase-filter');
        const projectCards = document.querySelectorAll('#showcase-grid .project-card');
        filterBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                const filter = btn.getAttribute('data-filter') || 'all';
                filterBtns.forEach((b) => {
                    const on = b === btn;
                    b.classList.toggle('is-active', on);
                    b.setAttribute('aria-selected', on ? 'true' : 'false');
                });
                projectCards.forEach((card) => {
                    const cat = card.getAttribute('data-category');
                    const show = filter === 'all' || cat === filter;
                    card.classList.toggle('is-filtered-out', !show);
                });
            });
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const overlay = document.getElementById('nav-overlay');
        const menuBtn = document.getElementById('menu-btn');
        setupMobileNav(overlay, menuBtn);

        let data;
        try {
            const res = await fetch(CONTENT_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error(res.statusText);
            data = await res.json();
        } catch (err) {
            console.error('Could not load content.json. Open this site via a local server (not file://).', err);
            document.querySelector('.main').innerHTML =
                '<p class="prose" style="padding:3rem;color:#ff5733;">Load <code>content.json</code> failed. Run <code>python3 -m http.server</code> in the portfolio folder and open <code>http://localhost:8000</code>.</p>';
            return;
        }

        renderPortfolio(data);

        initReveal();

        document.getElementById('contact-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
        });

        const updateActiveLink = setupScrollSpy();
        updateActiveLink();

        initShowcaseFilters();
        initSkillRings();
        initCounters();
    });
})();
