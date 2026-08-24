# CLAUDE.md

This file guides Claude Code when working in this repository.

## Project
Multi-tenant Field Service Management SaaS. Read `docs/BUSINESS-PLAN.md` and `docs/ARCHITECTURE.md` before making structural changes. Phasing lives in `docs/ROADMAP.md`.

## Stack
Next.js 15 (App Router), TypeScript strict, Supabase (Postgres/Auth/Storage/RLS), Stripe, Vercel. UI components come from the `@yourorg/ui` design-system package — never build one-off styled components in this repo.

## Non-negotiable rules
1. Every tenant-scoped table has `organization_id` and an RLS policy. No exceptions, no service-role shortcuts from client code.
2. Permissions are checked through `lib/rbac/permissions.ts` — never inline `if (role === 'planner')` checks.
3. Feature access goes through `hasFeature(org, key)` — never assume a module is available.
4. No ad-hoc CSS/styling — use `@yourorg/ui` tokens and components.
5. Server Components by default; `use client` only when interactivity requires it.
6. Every PR maps to a GitHub project board issue; update its status.
7. Backlog stories (title + description + acceptance criteria) are authored by the product owner on the GitHub project board — build exactly what a story's acceptance criteria specify, don't add modules/features beyond them unprompted. Within that scope, still build with full domain-completeness craftsmanship by default: sub-entities, tenant-configurable reference data, dependent/cascading reference lists where a real dependency exists, relational detail pages, and the right popup-vs-full-page weight (see `docs/ARCHITECTURE.md`'s "Domain completeness"/"Relational detail pages"/"Popup vs. full page" sections) — these are implementation-quality standards for *how* to build what's asked, not license to invent *what* to build. If a story's acceptance criteria are ambiguous or clearly incomplete for what they describe, ask before assuming.

## Working with subagents
Specialized subagents live in `.claude/agents/`. Delegate to them for their domain instead of doing the work inline in the main thread:
- `db-schema-architect` — schema/migrations/RLS
- `auth-rbac-engineer` — auth, tenancy, roles, feature flags
- `api-backend-engineer` — server actions/route handlers, business logic
- `frontend-ui-engineer` — pages, views, design-system consumption
- `billing-engineer` — Stripe products/prices/webhooks
- `qa-reviewer` — tests, RLS coverage, accessibility, review before merge
- `devops-release` — CI/CD, Vercel config, env/secrets, project board hygiene

## Change size — calibrate effort before delegating
Classify every change before starting work. Don't default to the heavy pipeline below for things that don't need it.

- **Small edit** — copy/style tweak, bug fix in existing logic, one-off UI adjustment, adding a field to an existing form, a config value, tweaking an existing query. Just make the change directly (inline, or via the single relevant specialist). No new tests, no `qa-reviewer` gate, no `docs/ARCHITECTURE.md` update, no spinning up a dev server or running e2e/RLS suites to self-verify. Run typecheck/lint if touching TS. The user tests it themselves in the browser — don't do it for them.
- **New feature/module** — new schema, new role/permission, new sellable module, new pricing, cross-tenant data-shape change. Full "Definition of done" applies.

If genuinely unsure which bucket a change falls in, ask rather than defaulting to the full pipeline.

## Definition of done (new features/modules only)
- RLS policy exists and is tested
- Permission matrix updated if a new module/action is introduced
- Feature flag registered if the module is sellable separately
- Tests pass (`qa-reviewer` signs off)
- Project board issue moved to Done
