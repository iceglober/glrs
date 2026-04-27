# glrs.dev docs

Starlight-based static site for the `@glrs-dev` ecosystem. Published to https://glrs.dev from the monorepo on push to main via `.github/workflows/docs-deploy.yml`.

## Local dev

```bash
bun run --filter @glrs-dev/docs dev      # http://localhost:4321
bun run --filter @glrs-dev/docs build    # → dist/
bun run --filter @glrs-dev/docs preview  # serve dist/ locally
```

## Authoring

Content is MDX in `src/content/docs/`. Starlight conventions:

- `index.mdx` → the landing page for that section
- Frontmatter fields: `title`, `description`, optional `template: splash` for hero-style pages
- Sidebar structure: see `astro.config.mjs` — edit the `sidebar` array

## Deployment

Pipeline:
1. Push to `main` touching `docs/**` triggers `.github/workflows/docs-deploy.yml`
2. Workflow builds with `bun run --filter @glrs-dev/docs build` → `docs/dist/`
3. Authenticates to GCP via Workload Identity Federation (no long-lived keys)
4. `gsutil -m rsync -d -r docs/dist/ gs://${{ vars.GCP_DOCS_BUCKET }}/`
5. `gcloud compute url-maps invalidate-cdn-cache` to flush the CDN

Infrastructure is managed as code in `infra/gcp/` via Pulumi (state in GCS bucket, not Pulumi Cloud).

## Content scope

This site is the monorepo's front door. It should cover:

- Overview + install for each published package
- Cross-cutting concepts (the dispatcher, Changesets workflow, agent harness loop)
- Getting-started tutorials
- API / CLI references (generated from source where practical)

Content authoring is ongoing. For now, each package's README in the repo is the authoritative source.

## Out of scope

- Blog / news / changelog aggregator. Releases are announced in per-package CHANGELOG.md and GitHub Releases.
- User-forums. We use GitHub Issues + Discussions.
- Marketing pages. The hero is the install command.
