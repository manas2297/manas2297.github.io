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

## 3D scene

The home page renders a scroll-driven Three.js scene behind the content (`static/js/scene.js`, styles in `static/css/scene.css`). Three.js r169 and its bloom post-processing addons are vendored under `static/vendor/three/` and loaded through an import map in `layouts/index.html`, so there is still no npm or bundler step.

- Each homepage section (`#welcome`, `#about`, `#experience`, `#works`, `#contact`) has a camera keyframe in `scene.js`; reorder or add sections there.
- The experience ring count and the works card count follow the number of roles and project cards on the page.
- Visitors without WebGL get a static gradient; visitors with reduced motion get a still frame that only moves when they scroll.

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

