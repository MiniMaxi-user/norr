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
Any new third-party service (analytics, error tracking, etc.) must get an
entry in `docs/ARCHITECTURE.md` plus its keys added here, to Vercel, and to
`.env.example` — see CLAUDE.md / the `devops-release` agent rules.

## `@yourorg/ui` (design system) — in-repo workspace package

`@yourorg/ui` lives in this repo (`packages/ui`), built as an npm workspace
package — there is no separate registry/`NPM_TOKEN` dependency to configure
for it. `npm install`/`npm ci` link it automatically via npm workspaces
(root `package.json`'s `"workspaces": ["packages/*"]`). Both Vercel and
GitHub Actions (`.github/workflows/ci.yml`) build it (`npm run build -w
@yourorg/ui`) before building/typechecking the app, since the app consumes
its `dist/` output like any other dependency, not via source transpilation.
See `docs/ARCHITECTURE.md`'s "Design system consumption" section for the
full picture.

## GitHub Actions

`.github/workflows/ci.yml` runs lint, typecheck, test, and build on every
PR into `main` and blocks merge on failure (branch protection must be
configured in GitHub repo settings to require this check — that's a manual
one-time setup step, same as Vercel project linking).

## Project board hygiene

Every PR should reference its GitHub issue and move the corresponding
project board card through **Backlog → Ready → In Progress → In Review →
Done** as work progresses (see `docs/ROADMAP.md`).
