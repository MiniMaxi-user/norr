# Deployment

## Vercel project setup (one-time, manual — requires interactive login)

1. `npm install -g vercel` (or use `npx vercel`).
2. `vercel login` — interactive, authenticates your Vercel account.
3. From the repo root: `vercel link` — links this repo to a Vercel project
   (create a new one or attach to an existing one).
4. `vercel git connect` (or connect the GitHub repo from the Vercel
   dashboard) so Vercel builds a **preview deployment per PR** and deploys
   **production on pushes to `main`**, per CLAUDE.md.

## Environment variables

Set these in the Vercel project (Project Settings → Environment Variables),
scoped per environment (Production / Preview / Development) as noted. Never
commit real values — `.env.example` documents the full list and is the
source of truth for what needs to exist.

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Prod + Preview + Dev | Use a separate Supabase project for Preview vs Production if possible, so PR previews don't touch production data. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Prod + Preview + Dev | Public, safe to expose to the browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod + Preview | Server-only. Never expose via `NEXT_PUBLIC_*`. |
| `STRIPE_SECRET_KEY` | Prod + Preview | Use Stripe test-mode keys for Preview. Added when billing-engineer wires up Phase 3. |
| `STRIPE_WEBHOOK_SECRET` | Prod + Preview | Per-endpoint webhook signing secret. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Prod + Preview + Dev | Public. |
| `NEXT_PUBLIC_SITE_URL` | Prod + Preview + Dev | Preview deployments can use Vercel's `VERCEL_URL` system env var instead if a per-PR URL is preferred over a fixed one. |
| `NPM_TOKEN` | GitHub Actions secret + Vercel (if `npm ci` needs to pull `@yourorg/ui`) | Auth token for the private registry the `design-system` repo publishes to. See `.npmrc`. |

Any new third-party service (analytics, error tracking, etc.) must get an
entry in `docs/ARCHITECTURE.md` plus its keys added here, to Vercel, and to
`.env.example` — see CLAUDE.md / the `devops-release` agent rules.

## `@yourorg/ui` (design-system) dependency

`@yourorg/ui` is published from the separate `design-system` repo to a
private package registry (see `.npmrc`). This app repo:

- **never** vendors or path-references the design-system source locally,
- consumes it as a normal versioned npm dependency,
- requires `NPM_TOKEN` (scoped to the `@yourorg` registry) to be present
  wherever `npm install`/`npm ci` runs against this repo — GitHub Actions
  and Vercel both need it configured as a secret/env var.

**Known sequencing gap (Phase 0):** as of this scaffold, `@yourorg/ui` has
not published a v0.1 yet, so `npm install`/`npm ci` will fail to resolve it
until either (a) the design-system repo publishes an initial version and
`NPM_TOKEN` is configured, or (b) the dependency is temporarily removed from
`package.json`. The app code does not yet import anything from the package,
so removing it from `package.json` is a safe, reversible way to unblock
local installs/CI in the meantime.

## GitHub Actions

`.github/workflows/ci.yml` runs lint, typecheck, test, and build on every
PR into `main` and blocks merge on failure (branch protection must be
configured in GitHub repo settings to require this check — that's a manual
one-time setup step, same as Vercel project linking).

## Project board hygiene

Every PR should reference its GitHub issue and move the corresponding
project board card through **Backlog → Ready → In Progress → In Review →
Done** as work progresses (see `docs/ROADMAP.md`).
