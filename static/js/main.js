document.addEventListener('DOMContentLoaded', () => {
    // 1. Mobile Menu Toggles
    const menuBtn = document.getElementById('menu-btn');
    const sidebar = document.getElementById('sidebar');
    const navOverlay = document.getElementById('nav-overlay');

    if (menuBtn && sidebar && navOverlay) {
        const toggleMenu = () => {
            const isOpen = sidebar.classList.toggle('is-open');
            navOverlay.classList.toggle('is-active', isOpen);
            menuBtn.setAttribute('aria-expanded', isOpen);
        };

        menuBtn.addEventListener('click', toggleMenu);
        navOverlay.addEventListener('click', toggleMenu);

        // Close menu on clicking links (mobile)
        sidebar.querySelectorAll('.sidebar-link').forEach(link => {
            link.addEventListener('click', () => {
                if (sidebar.classList.contains('is-open')) {
                    toggleMenu();
                }
            });
        });
    }

    // 2. Scroll Reveal Animations using IntersectionObserver
    const revealElements = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window) {
        const revealObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-revealed');
                    revealObserver.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.15,
            rootMargin: '0px 0px -50px 0px'
        });

        revealElements.forEach(el => revealObserver.observe(el));
    } else {
        // Fallback for older browsers
        revealElements.forEach(el => el.classList.add('is-revealed'));
    }

    // 3. Stats Counter Animation
    const statNums = document.querySelectorAll('.stat-item__num');
    const animateStats = () => {
        statNums.forEach(num => {
            const target = parseInt(num.getAttribute('data-target'), 10) || 0;
            let current = 0;
            const increment = Math.ceil(target / 40);
            const timer = setInterval(() => {
                current += increment;
                if (current >= target) {
                    num.textContent = target;
                    clearInterval(timer);
                } else {
                    num.textContent = current;
                }
            }, 30);
        });
    };

    // Trigger stats animation when skills section comes into view
    const skillsSection = document.getElementById('skills');
    if (skillsSection && 'IntersectionObserver' in window) {
        const statsObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    animateStats();
                    statsObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.2 });
        statsObserver.observe(skillsSection);
    } else {
        animateStats();
    }

    // 4. Sidebar Active Navigation Spy
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.sidebar-link');

    window.addEventListener('scroll', () => {
        let scrollY = window.pageYOffset;
        sections.forEach(current => {
            const sectionHeight = current.offsetHeight;
            const sectionTop = current.offsetTop - 150;
            const sectionId = current.getAttribute('id');

            if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
                navLinks.forEach(link => {
                    link.classList.remove('is-active');
                    if (link.getAttribute('href').endsWith('#' + sectionId)) {
                        link.classList.add('is-active');
                    }
                });
            }
        });
    });
});
