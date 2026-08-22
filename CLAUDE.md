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

## Working with subagents
Specialized subagents live in `.claude/agents/`. Delegate to them for their domain instead of doing the work inline in the main thread:
- `db-schema-architect` — schema/migrations/RLS
- `auth-rbac-engineer` — auth, tenancy, roles, feature flags
- `api-backend-engineer` — server actions/route handlers, business logic
- `frontend-ui-engineer` — pages, views, design-system consumption
- `billing-engineer` — Stripe products/prices/webhooks
- `qa-reviewer` — tests, RLS coverage, accessibility, review before merge
- `devops-release` — CI/CD, Vercel config, env/secrets, project board hygiene

## Definition of done (per feature)
- RLS policy exists and is tested
- Permission matrix updated if a new module/action is introduced
- Feature flag registered if the module is sellable separately
- Tests pass (`qa-reviewer` signs off)
- Project board issue moved to Done
