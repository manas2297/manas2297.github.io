// Scroll-driven 3D backdrop for the home page.
// The camera flies along -z through one "set piece" per section:
// welcome → event cluster, about → core, experience → ring tunnel,
// works → card helix, contact → particle knot.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const canvas = document.getElementById('scene');
const root = document.documentElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const supportsWebGL = () => {
    try {
        const probe = document.createElement('canvas');
        return !!(probe.getContext('webgl2') || probe.getContext('webgl'));
    } catch {
        return false;
    }
};

if (canvas && supportsWebGL()) {
    init();
} else {
    root.classList.add('scene-fallback');
}

function init() {
    const BG = new THREE.Color('#05070c');
    const INDIGO = new THREE.Color('#6366f1');
    const VIOLET = new THREE.Color('#a78bfa');
    const CYAN = new THREE.Color('#22d3ee');

    const isSmall = () => window.innerWidth < 820;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(BG, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(BG, 0.02);

    const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);
    camera.position.set(0, 0, 14);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.55, 0.12);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // Soft round sprite shared by every point cloud.
    const glow = (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.25, 'rgba(255,255,255,0.75)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    })();

    const pointsMaterial = (color, size, opacity = 1) =>
        new THREE.PointsMaterial({
            color,
            size,
            map: glow,
            transparent: true,
            opacity,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

    const lineMaterial = (color, opacity) =>
        new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

    const rand = (min, max) => min + Math.random() * (max - min);

    // ── Dust: depth cues along the whole flight path ──
    const dust = (() => {
        const count = isSmall() ? 1400 : 2800;
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            pos[i * 3] = rand(-60, 60);
            pos[i * 3 + 1] = rand(-35, 35);
            pos[i * 3 + 2] = rand(-290, 30);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const pts = new THREE.Points(geo, pointsMaterial(new THREE.Color('#8b93a7'), 0.18, 0.55));
        scene.add(pts);
        return pts;
    })();

    // ── Welcome: a broker cluster with events hopping between nodes ──
    const cluster = (() => {
        const group = new THREE.Group();
        const n = 120;
        const nodes = [];
        const golden = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < n; i++) {
            const y = 1 - (i / (n - 1)) * 2;
            const r = Math.sqrt(1 - y * y);
            const theta = golden * i;
            const radius = 4.6 + rand(-0.7, 0.7);
            nodes.push(new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius));
        }

        // Link each node to its three nearest neighbours.
        const adjacency = nodes.map(() => new Set());
        nodes.forEach((a, i) => {
            nodes
                .map((b, j) => ({ j, d: a.distanceToSquared(b) }))
                .filter(({ j }) => j !== i)
                .sort((x, y) => x.d - y.d)
                .slice(0, 3)
                .forEach(({ j }) => {
                    adjacency[i].add(j);
                    adjacency[j].add(i);
                });
        });
        const neighbours = adjacency.map((s) => [...s]);

        const edgePos = [];
        neighbours.forEach((list, i) =>
            list.forEach((j) => {
                if (j > i) edgePos.push(...nodes[i].toArray(), ...nodes[j].toArray());
            })
        );
        const edgeGeo = new THREE.BufferGeometry();
        edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
        group.add(new THREE.LineSegments(edgeGeo, lineMaterial(INDIGO, 0.35)));

        const nodeGeo = new THREE.BufferGeometry().setFromPoints(nodes);
        group.add(new THREE.Points(nodeGeo, pointsMaterial(VIOLET, 0.45)));

        const packetCount = 70;
        const packets = Array.from({ length: packetCount }, () => {
            const from = Math.floor(Math.random() * n);
            const list = neighbours[from];
            return { from, to: list[Math.floor(Math.random() * list.length)], t: Math.random(), speed: rand(0.5, 1.4) };
        });
        const packetPos = new Float32Array(packetCount * 3);
        const packetGeo = new THREE.BufferGeometry();
        packetGeo.setAttribute('position', new THREE.BufferAttribute(packetPos, 3));
        group.add(new THREE.Points(packetGeo, pointsMaterial(CYAN, 0.32)));

        const core = new THREE.Mesh(
            new THREE.IcosahedronGeometry(1.1, 1),
            new THREE.MeshBasicMaterial({ color: INDIGO, wireframe: true, transparent: true, opacity: 0.6 })
        );
        group.add(core);

        scene.add(group);

        const tmp = new THREE.Vector3();
        const update = (dt, time) => {
            packets.forEach((p, i) => {
                p.t += dt * p.speed;
                if (p.t >= 1) {
                    p.t -= 1;
                    p.from = p.to;
                    const list = neighbours[p.from];
                    p.to = list[Math.floor(Math.random() * list.length)];
                }
                tmp.lerpVectors(nodes[p.from], nodes[p.to], p.t);
                packetPos[i * 3] = tmp.x;
                packetPos[i * 3 + 1] = tmp.y;
                packetPos[i * 3 + 2] = tmp.z;
            });
            packetGeo.attributes.position.needsUpdate = true;
            core.rotation.x = time * 0.3;
            core.rotation.y = time * 0.45;
        };

        return { group, update, z: -6, reach: 8 };
    })();

    // ── About: an orbital core ──
    const about = (() => {
        const group = new THREE.Group();
        const shell = new THREE.LineSegments(
            new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(3, 1)),
            lineMaterial(VIOLET, 0.4)
        );
        const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 0), new THREE.MeshBasicMaterial({ color: INDIGO }));
        group.add(shell, heart);

        const orbits = [0, 1, 2].map((k) => {
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(4.4 + k * 0.6, 0.02, 6, 140),
                new THREE.MeshBasicMaterial({ color: k === 1 ? CYAN : INDIGO, transparent: true, opacity: 0.7 })
            );
            ring.rotation.set(rand(0, Math.PI), rand(0, Math.PI), 0);
            group.add(ring);
            return ring;
        });

        scene.add(group);
        group.position.set(9, -0.5, -55);

        const update = (dt) => {
            shell.rotation.y += dt * 0.15;
            shell.rotation.x += dt * 0.05;
            heart.rotation.y -= dt * 0.4;
            orbits.forEach((ring, k) => {
                ring.rotation.z += dt * (0.2 + k * 0.1);
            });
        };
        return { group, update, z: -55, reach: 8 };
    })();

    // ── Experience: one ring per role, flown through in order ──
    const experience = (() => {
        const group = new THREE.Group();
        const roleCount = Math.max(document.querySelectorAll('.journey-item').length, 3);
        const start = -92;
        const span = 56;
        const rings = [];
        for (let i = 0; i < roleCount; i++) {
            const z = start - (span * i) / Math.max(roleCount - 1, 1);
            const color = INDIGO.clone().lerp(CYAN, i / Math.max(roleCount - 1, 1));
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(4.2, 0.035, 8, 180),
                new THREE.MeshBasicMaterial({ color })
            );
            ring.position.z = z;
            const marker = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
            marker.position.x = 4.2;
            const pivot = new THREE.Group();
            pivot.position.z = z;
            pivot.rotation.z = (i / roleCount) * Math.PI * 2;
            pivot.add(marker);
            group.add(ring, pivot);
            rings.push({ ring, pivot });
        }

        // Event stream flowing back toward the viewer through the rings.
        const streamCount = 360;
        const streamPos = new Float32Array(streamCount * 3);
        const zMax = start + 14;
        const zMin = start - span - 14;
        for (let i = 0; i < streamCount; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = rand(0.4, 3.4);
            streamPos[i * 3] = Math.cos(a) * r;
            streamPos[i * 3 + 1] = Math.sin(a) * r;
            streamPos[i * 3 + 2] = rand(zMin, zMax);
        }
        const streamGeo = new THREE.BufferGeometry();
        streamGeo.setAttribute('position', new THREE.BufferAttribute(streamPos, 3));
        group.add(new THREE.Points(streamGeo, pointsMaterial(CYAN, 0.16, 0.8)));

        scene.add(group);

        const update = (dt) => {
            rings.forEach(({ ring, pivot }, i) => {
                ring.rotation.z += dt * 0.1;
                pivot.rotation.z += dt * (0.5 + i * 0.05);
            });
            for (let i = 0; i < streamCount; i++) {
                let z = streamPos[i * 3 + 2] + dt * 9;
                if (z > zMax) z = zMin;
                streamPos[i * 3 + 2] = z;
            }
            streamGeo.attributes.position.needsUpdate = true;
        };
        return { group, update, z: -120, reach: 36 };
    })();

    // ── Works: a helix of project cards around the flight path ──
    const works = (() => {
        const group = new THREE.Group();
        const cardCount = Math.max(document.querySelectorAll('.proj-card').length, 4);
        const frameGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.6, 3.4, 0.06));
        const paneGeo = new THREE.PlaneGeometry(2.5, 3.3);
        const cards = [];
        for (let i = 0; i < cardCount; i++) {
            const angle = (i / cardCount) * Math.PI * 2 * 1.25;
            const z = -172 - i * (30 / cardCount);
            const color = i % 2 ? VIOLET : CYAN;
            const card = new THREE.Group();
            card.add(new THREE.LineSegments(frameGeo, lineMaterial(color, 0.9)));
            card.add(
                new THREE.Mesh(
                    paneGeo,
                    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })
                )
            );
            card.position.set(Math.cos(angle) * 6, Math.sin(angle) * 4, z);
            card.lookAt(0, 0, z);
            group.add(card);
            cards.push({ card, angle, z, bob: Math.random() * Math.PI * 2 });
        }
        scene.add(group);

        const update = (dt, time) => {
            group.rotation.z += dt * 0.06;
            cards.forEach(({ card, bob }) => {
                card.position.z += Math.sin(time * 0.8 + bob) * dt * 0.3;
            });
        };
        return { group, update, z: -187, reach: 20 };
    })();

    // ── Contact: everything resolves into one knot ──
    const contact = (() => {
        const group = new THREE.Group();
        const knotGeo = new THREE.TorusKnotGeometry(3.4, 0.9, 260, 18, 2, 3);
        const knot = new THREE.Points(knotGeo, pointsMaterial(INDIGO, 0.14, 0.9));
        const heart = new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 32), new THREE.MeshBasicMaterial({ color: CYAN }));
        group.add(knot, heart);
        group.position.set(0, 4.2, -246);
        scene.add(group);

        const update = (dt, time) => {
            knot.rotation.y += dt * 0.25;
            knot.rotation.x += dt * 0.1;
            const s = 1 + Math.sin(time * 2.2) * 0.12;
            heart.scale.setScalar(s);
        };
        return { group, update, z: -246, reach: 8 };
    })();

    const setPieces = [cluster, about, experience, works, contact];

    const layout = () => {
        const small = isSmall();
        cluster.group.position.set(small ? 0 : 6.5, small ? 2.5 : 0.2, small ? -14 : -6);
        cluster.group.scale.setScalar(small ? 0.85 : 1);
        about.group.position.x = small ? 0 : 9;
        about.group.position.z = small ? -62 : -55;
        about.z = about.group.position.z;
    };
    layout();

    // ── Scroll → camera keyframes (one per section start, plus the page end) ──
    const keyframes = {
        welcome: { pos: [0, 0, 14], look: [0, 0, -6] },
        about: { pos: [0, 0.6, -26], look: [2, 0, -55] },
        experience: { pos: [0, 0, -76], look: [0, 0, -100] },
        works: { pos: [0, 1, -156], look: [0, 0, -190] },
        contact: { pos: [0, 0, -210], look: [0, 1.6, -246] },
        end: { pos: [0, -0.5, -224], look: [0, 2.2, -246] },
    };
    const sectionIds = Object.keys(keyframes).filter((id) => id !== 'end');
    const sections = sectionIds.map((id) => document.getElementById(id)).filter(Boolean);
    const frames = [...sections.map((el) => keyframes[el.id]), keyframes.end].map((k) => ({
        pos: new THREE.Vector3(...k.pos),
        look: new THREE.Vector3(...k.look),
    }));

    const hudLabel = document.getElementById('scene-hud-label');
    const hudBar = document.getElementById('scene-hud-bar');
    const hudDepth = document.getElementById('scene-hud-depth');

    const targetPos = new THREE.Vector3();
    const targetLook = new THREE.Vector3();
    const look = new THREE.Vector3(...keyframes.welcome.look);
    let activeIndex = -1;

    const sampleScroll = () => {
        const vh = window.innerHeight;
        const scrollY = window.scrollY;
        const maxScroll = Math.max(document.documentElement.scrollHeight - vh, 1);
        // Segment i starts when section i's top reaches mid-viewport.
        const stops = sections.map((el, i) => (i === 0 ? 0 : Math.max(el.getBoundingClientRect().top + scrollY - vh * 0.5, 0)));
        stops.push(maxScroll);

        let i = 0;
        while (i < stops.length - 2 && scrollY >= stops[i + 1]) i++;
        const f = THREE.MathUtils.clamp((scrollY - stops[i]) / Math.max(stops[i + 1] - stops[i], 1), 0, 1);
        const eased = f * f * (3 - 2 * f);

        targetPos.lerpVectors(frames[i].pos, frames[i + 1].pos, eased);
        targetLook.lerpVectors(frames[i].look, frames[i + 1].look, eased);

        if (i !== activeIndex && hudLabel) {
            activeIndex = i;
            const name = sections[i].getAttribute('data-scene-label') || sections[i].id;
            hudLabel.textContent = `${String(i + 1).padStart(2, '0')} / ${name}`;
        }
        if (hudBar) hudBar.style.transform = `scaleX(${Math.min(scrollY / maxScroll, 1)})`;
    };

    const pointer = new THREE.Vector2();
    const pointerSmooth = new THREE.Vector2();
    window.addEventListener(
        'pointermove',
        (e) => {
            pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
        },
        { passive: true }
    );

    window.addEventListener(
        'resize',
        () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            composer.setSize(window.innerWidth, window.innerHeight);
            layout();
        },
        { passive: true }
    );

    const clock = new THREE.Clock();

    const frame = (dt, settle) => {
        const time = clock.elapsedTime;
        sampleScroll();
        pointerSmooth.lerp(pointer, settle ? 1 : 1 - Math.exp(-dt * 3));

        const k = settle ? 1 : 1 - Math.exp(-dt * 4);
        camera.position.lerp(targetPos, k);
        camera.position.x += pointerSmooth.x * 0.9 * k;
        camera.position.y += -pointerSmooth.y * 0.6 * k;
        look.lerp(targetLook, k);
        camera.lookAt(look);

        cluster.group.rotation.y = time * 0.08 + pointerSmooth.x * 0.35;
        cluster.group.rotation.x = pointerSmooth.y * 0.25;
        setPieces.forEach((piece) => {
            // Skip set pieces that are far ahead or behind; fog would only show them as murky blobs.
            const ahead = camera.position.z - piece.z;
            piece.group.visible = ahead < 55 + piece.reach && ahead > -(piece.reach + 10);
            if (piece.group.visible) piece.update(dt, time);
        });
        dust.rotation.z = time * 0.004;

        if (hudDepth) hudDepth.textContent = `z ${camera.position.z.toFixed(1)}`;
        composer.render();
    };

    root.classList.add('has-scene');

    if (reducedMotion) {
        // One still frame, refreshed only when the reader scrolls.
        clock.getDelta();
        frame(0, true);
        let pending = false;
        window.addEventListener(
            'scroll',
            () => {
                if (pending) return;
                pending = true;
                requestAnimationFrame(() => {
                    pending = false;
                    frame(0, true);
                });
            },
            { passive: true }
        );
    } else {
        frame(0, true);
        renderer.setAnimationLoop(() => {
            if (document.hidden) return;
            frame(Math.min(clock.getDelta(), 0.05), false);
        });
    }

    requestAnimationFrame(() => canvas.classList.add('is-ready'));
}
