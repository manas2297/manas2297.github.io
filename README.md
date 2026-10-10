# Manas Yadav - Portfolio Site

This repository powers a lightweight portfolio site built with [Hugo](https://gohugo.io/).

## Prerequisites

Install Hugo on your machine:

- **macOS (Homebrew):** `brew install hugo`
- **Linux:** `sudo apt install hugo` or use your package manager
- **Windows:** `choco install hugo-extended`

## Local Development

Start the Hugo development server:

```bash
hugo server -D
```

Then open your browser at:

- `http://localhost:1313/`

### Alternative: Static HTML preview with Python

If you prefer building static HTML and previewing via Python:

```bash
hugo
cd public
python3 -m http.server 8000
```

Then open: `http://localhost:8000`

## Depth & scroll effects

The home page effects live in `static/js/stack3d.js` (hero model), `static/js/works-motion.js` (case-study deck) and `static/js/depth.js` (everything else):

- **Hero model:** `static/js/stack3d.js` renders a lit Three.js model of the architecture: edge, Go services, Kafka partitions with live messages, and storage. The layers separate as you scroll, hovering a layer shows a real metric, and an idle cycle walks through the layers. Three.js r169 is vendored under `static/vendor/three/` and loaded through an import map, so there's no npm step. Without WebGL, the CSS-3D stack in `layouts/index.html` is shown instead.
- **Case-study deck:** `static/js/works-motion.js` (styles in `static/css/deck.css`) uses Motion, the vanilla-JS engine behind Framer Motion, which loads from the CDN in `layouts/partials/footer.html`. Cards pin under the header and stack as you scroll, and each covered card shrinks, tips back and dims. Images unmask and the copy staggers in on arrival, and cards turn toward the mouse on a spring. Without Motion or with reduced motion, the cards still stack, just without animation.
- **Request path:** a curve in the left gutter that draws from `GET /` to `200 OK` as you scroll. Each section's label comes from its `data-route` attribute.
- **Experience rail:** the timeline fills role by role.
- **Perspective:** cards and panels lean back until they are inside the viewport, and project cards tilt toward the pointer.

With reduced motion, everything renders fully drawn and nothing animates.

## Editing Site Content

All homepage content is templated out into YAML data files in `data/` and `hugo.toml`:

- **Work Experience & Companies:** [`data/experience.yaml`](file:///Users/manas/Documents/portfolio/data/experience.yaml)
  - Add or update roles, company names, dates, descriptions, and the core stack list.
- **About Section & Highlights:** [`data/about.yaml`](file:///Users/manas/Documents/portfolio/data/about.yaml)
  - Edit the summary paragraphs (markdown-supported) and "Where I add value" points.
- **Featured / Open-Source Projects:** [`data/featured_projects.yaml`](file:///Users/manas/Documents/portfolio/data/featured_projects.yaml)
  - Add repository cards (like GoKafkaToolkit) with title, tags, description, and link.
- **Hero & General Site Configuration:** [`hugo.toml`](file:///Users/manas/Documents/portfolio/hugo.toml)
  - Update email, social links (`[params.social]`), headline, availability badge, and navigation.

## Deploy on GitHub Pages

Because this site uses Hugo templates, GitHub Pages needs to build the site using GitHub Actions:

1. Push this repository to GitHub.
2. Go to **Settings** > **Pages** in your GitHub repository.
3. Under **Build and deployment**:
   - Set **Source** to **GitHub Actions**.
4. Select the standard **Hugo** GitHub Actions workflow (or create `.github/workflows/hugo.yml`).

Your site will automatically build and deploy to:

- `https://manas2297.github.io/`

## Optional: GitHub Profile README

To customize your GitHub profile page (`https://github.com/manas2297`), create a **separate** repository named `manas2297` with a `README.md`.

Starter example:

```md
# Hey, I'm Manas Yadav

Platform-focused engineer building distributed systems, cloud-native architecture, and developer tooling.

## What I work on
- High-throughput backend systems
- Kafka and event-driven architecture
- Kubernetes and cloud infrastructure
- Open-source Go tooling

## Featured repos
- [GoKafkaToolkit](https://github.com/manas2297/GoKafkaToolkit)
- [hash_go](https://github.com/manas2297/hash_go)
- [tickbrick-microservice](https://github.com/manas2297/tickbrick-microservice)

## Connect
- GitHub: [@manas2297](https://github.com/manas2297)
- LinkedIn: [in/manas2297](https://www.linkedin.com/in/manas2297)
```

