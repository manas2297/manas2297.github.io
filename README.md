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

- `http://localhost:1313/portfolio/`

> **Note:** If you want to preview without the `/portfolio/` subpath locally, run:
> ```bash
> hugo server --baseURL http://localhost:1313/
> ```
> then open `http://localhost:1313/`.

### Alternative: Static HTML preview with Python

If you prefer building static HTML and previewing via Python:

```bash
hugo
cd public
python3 -m http.server 8000
```

Then open: `http://localhost:8000`

## Deploy on GitHub Pages

Because this site uses Hugo templates, GitHub Pages needs to build the site using GitHub Actions:

1. Push this repository to GitHub.
2. Go to **Settings** > **Pages** in your GitHub repository.
3. Under **Build and deployment**:
   - Set **Source** to **GitHub Actions**.
4. Select the standard **Hugo** GitHub Actions workflow (or create `.github/workflows/hugo.yml`).

Your site will automatically build and deploy to:

- `https://manas2297.github.io/portfolio/`

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

