// Hero architecture model in Three.js: edge → services → Kafka → storage.
// Replaces the CSS stack when WebGL is available; the CSS version stays as fallback.
// Layers separate as the page scrolls, Kafka partitions carry live messages,
// and hovering (or the idle cycle) highlights a layer with a real metric.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const host = document.getElementById('stack');
const hero = document.querySelector('.hero');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const LAYERS = [
    { name: 'Storage · Postgres / Redis', metric: '22B-row dataset, DB size cut 80%' },
    { name: 'Event bus · Kafka', metric: 'Cross-region move, 250ms → <10ms' },
    { name: 'Services · Go / gRPC', metric: 'Secrets manager, 0 → 200M+ calls/day' },
    { name: 'Edge · API gateway', metric: 'AuthN/AuthZ rewrite in Go, 70% faster' },
];

const hasWebGL = () => {
    try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
        return false;
    }
};

if (host && hasWebGL()) init();

function init() {
    const ACCENT = new THREE.Color('#1f4fd1');
    const ACCENT_SOFT = new THREE.Color('#c9d6f7');
    const SLAB = new THREE.Color('#ffffff');
    const BUS = new THREE.Color('#eef2fd');
    const NODE = new THREE.Color('#ece9e1');

    const canvas = document.createElement('canvas');
    canvas.className = 'stack__canvas';
    const tags = document.createElement('div');
    tags.className = 'stack__tags';
    host.append(canvas, tags);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(22, 1, 1, 100);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xe7e3d9, 2.1));
    const fill = new THREE.DirectionalLight(0xffffff, 0.7);
    fill.position.set(12, 6, 14);
    scene.add(fill);
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-2, 16, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0008;
    scene.add(sun);

    const model = new THREE.Group();
    scene.add(model);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.07 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    model.add(ground);

    const mat = (color, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    const mesh = (geo, material) => {
        const m = new THREE.Mesh(geo, material);
        m.castShadow = true;
        m.receiveShadow = true;
        return m;
    };
    const box = (w, h, d, material) => mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.18), material);

    const SIZE = 6;
    const layers = LAYERS.map((info, i) => {
        const group = new THREE.Group();
        const slabMat = mat(i === 1 ? BUS : SLAB, 0.9);
        const slab = box(SIZE, 0.26, SIZE, slabMat);
        group.add(slab);
        model.add(group);
        return { ...info, group, slab, slabMat, lift: 0 };
    });

    const top = 0.13; // slab top surface

    // Storage: two databases and a cache.
    [
        [-1.3, -0.6, 1.0, 1.1],
        [1.0, -1.3, 0.85, 0.9],
        [1.2, 1.4, 0.6, 0.6],
    ].forEach(([x, z, r, h], k) => {
        const db = mesh(new THREE.CylinderGeometry(r, r, h, 40), mat(k === 2 ? ACCENT_SOFT : NODE));
        db.position.set(x, top + h / 2, z);
        layers[0].group.add(db);
        const lid = mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, 0.06, 40), mat(k === 2 ? ACCENT : 0xd9d5cb));
        lid.position.set(x, top + h * 0.66, z);
        layers[0].group.add(lid);
    });

    // Kafka: four partitions with messages appended along them.
    const partitionMat = mat(0xdde5fa);
    const messageMats = [mat(ACCENT, 0.6), mat(0x8aa4ea, 0.7)];
    const messages = [];
    for (let p = 0; p < 4; p++) {
        const z = -1.95 + p * 1.3;
        const lane = box(5.1, 0.12, 0.62, partitionMat);
        lane.position.set(0, top + 0.06, z);
        layers[1].group.add(lane);
        const speed = 0.7 + p * 0.18;
        for (let m = 0; m < 5; m++) {
            const msg = box(0.38, 0.3, 0.38, messageMats[(m + p) % 2]);
            msg.position.set(0, top + 0.27, z);
            layers[1].group.add(msg);
            messages.push({ msg, offset: m / 5, speed });
        }
    }

    // Services: a grid of pods of different sizes.
    const podMat = mat(NODE);
    const podAccent = mat(ACCENT, 0.6);
    [
        [-1.7, -1.5, 0.9], [0, -1.5, 0.6], [1.7, -1.5, 1.1],
        [-1.7, 0.4, 0.7], [0, 0.4, 1.2], [1.7, 0.4, 0.55],
        [-0.85, 2.0, 0.5], [0.85, 2.0, 0.8],
    ].forEach(([x, z, h], k) => {
        const pod = box(1.1, h, 1.1, k === 4 ? podAccent : podMat);
        pod.position.set(x, top + h / 2, z);
        layers[2].group.add(pod);
    });

    // Edge: gateway plus load balancers.
    const gateway = box(3.8, 0.55, 1.3, podMat);
    gateway.position.set(-0.4, top + 0.27, -1.1);
    layers[3].group.add(gateway);
    const gwStripe = box(3.0, 0.08, 0.12, podAccent);
    gwStripe.position.set(-0.4, top + 0.56, -0.44);
    layers[3].group.add(gwStripe);
    [[-1.4, 1.4], [0.4, 1.4], [2.2, 1.4]].forEach(([x, z]) => {
        const lb = box(1.0, 0.4, 1.0, podMat);
        lb.position.set(x, top + 0.2, z);
        layers[3].group.add(lb);
    });

    // Requests drop through every layer along three wires.
    const wireMat = new THREE.MeshBasicMaterial({ color: 0xb9c6ee });
    const packetMat = mat(ACCENT, 0.5);
    const wires = [
        [2.4, -2.4, 0],
        [-2.5, 2.2, 0.33],
        [2.5, 2.5, 0.66],
    ].map(([x, z, phase]) => {
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 8), wireMat);
        const packet = mesh(new THREE.SphereGeometry(0.16, 20, 20), packetMat);
        model.add(wire, packet);
        return { x, z, phase, wire, packet };
    });

    // One caption per layer; only the focused layer's caption shows.
    const tagEls = layers.map((layer) => {
        const el = document.createElement('div');
        el.className = 'stack__tag';
        el.innerHTML = `<span class="stack__tag-name"></span><span class="stack__tag-metric"></span>`;
        el.children[0].textContent = layer.name;
        el.children[1].textContent = layer.metric;
        tags.append(el);
        return el;
    });

    host.classList.add('is-3d');

    // ── Interaction ──
    const pointer = new THREE.Vector2(0, 0);
    const pointerSmooth = new THREE.Vector2(0, 0);
    const ndc = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    let hovered = -1;
    let active = 1;
    let lastSwitch = 0;

    if (hero) {
        hero.addEventListener(
            'pointermove',
            (e) => {
                pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
                const r = canvas.getBoundingClientRect();
                ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
                raycaster.setFromCamera(ndc, camera);
                const hit = raycaster.intersectObjects(layers.map((l) => l.group), true)[0];
                hovered = hit ? layers.findIndex((l) => hit.object.parent === l.group) : -1;
                wake();
            },
            { passive: true }
        );
        hero.addEventListener('pointerleave', () => {
            hovered = -1;
            pointer.set(0, 0);
            wake();
        });
    }

    // ── Layout ──
    // Fit the model's bounding sphere into the canvas.
    const RADIUS = 5.6;
    const VIEW_DIR = new THREE.Vector3(0.62, 0.55, 0.56).normalize();
    const resize = () => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        const vfov = THREE.MathUtils.degToRad(camera.fov);
        const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
        const dist = RADIUS / Math.sin(Math.min(vfov, hfov) / 2);
        camera.position.copy(VIEW_DIR).multiplyScalar(dist).add(new THREE.Vector3(0, 3.4, 0));
        camera.lookAt(0, 3.4, 0);
        camera.updateProjectionMatrix();
        wake();
    };

    const clock = new THREE.Clock();
    let visible = true;
    let running = false;

    const frame = () => {
        const dt = Math.min(clock.getDelta(), 0.05);
        const t = clock.elapsedTime;
        const vh = window.innerHeight;
        const open = Math.min(Math.max(window.scrollY / (vh * 0.7), 0), 1);
        const gap = 1.9 + open * 0.9;
        const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 6);

        if (hovered === -1 && !reducedMotion && t - lastSwitch > 3.2) {
            active = (active + 1) % layers.length;
            lastSwitch = t;
        }
        const focus = hovered === -1 ? active : hovered;

        layers.forEach((layer, i) => {
            layer.lift += ((i === focus ? 0.35 : 0) - layer.lift) * k;
            layer.group.position.y = i * gap + layer.lift;
            layer.slabMat.color.copy(i === 1 ? BUS : SLAB).lerp(ACCENT_SOFT, (layer.lift / 0.35) * 0.55);
        });

        pointerSmooth.lerp(pointer, k * 0.6);
        model.rotation.y = -0.12 + pointerSmooth.x * 0.22 + open * 0.35;
        model.rotation.x = pointerSmooth.y * 0.05;

        messages.forEach((m) => {
            const u = (m.offset + (reducedMotion ? 0.1 : t * m.speed * 0.12)) % 1;
            m.msg.position.x = -2.3 + u * 4.6;
            m.msg.scale.setScalar(Math.min(1, u * 8, (1 - u) * 8));
        });

        const topY = 3 * gap + 0.3;
        wires.forEach((w) => {
            w.wire.position.set(w.x, topY / 2, w.z);
            w.wire.scale.y = topY;
            const u = reducedMotion ? 0.5 : (t * 0.28 + w.phase) % 1;
            w.packet.position.set(w.x, topY * (1 - u), w.z);
            w.packet.scale.setScalar(Math.min(1, u * 10, (1 - u) * 10));
        });

        tagEls.forEach((el, i) => el.classList.toggle('is-active', i === focus));

        renderer.render(scene, camera);
    };

    const loop = () => {
        if (!running) return;
        frame();
        requestAnimationFrame(loop);
    };

    function wake() {
        if (reducedMotion) {
            frame();
            return;
        }
        if (running || !visible || document.hidden) return;
        running = true;
        clock.getDelta();
        requestAnimationFrame(loop);
    }

    const sleep = () => {
        running = false;
    };

    new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        visible ? wake() : sleep();
    }).observe(host);
    document.addEventListener('visibilitychange', () => (document.hidden ? sleep() : wake()));
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('scroll', () => reducedMotion && wake(), { passive: true });

    resize();
    frame();
    wake();
}
