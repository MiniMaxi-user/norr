# Roadmap

Phasing decided pragmatically: get multi-tenant auth, RBAC, and the premium app shell right before any business module — every later module depends on it.

## Phase 0 — Foundation
- Next.js + Supabase scaffold, CI/CD to Vercel (preview deployment per PR)
- `organizations`, `memberships`, baseline RLS, auth flows (signup, invite, login)
- RBAC permission layer (`lib/rbac`)
- App shell: collapsible nav, command palette, theming from `@yourorg/ui` (even a v0.1 of that package)
- GitHub project board + issue templates (see below)

## Phase 1 — Core CRM
- Clients module (CRUD, list/kanban views)
- Assets module (CRUD, linked to clients/sites, list/map views)
- Dashboard shell (layout only, widgets come in Phase 3)

## Phase 2 — Operations
- Contracts module (CRUD, linked assets, SLA terms)
- Planning module (calendar + kanban + list, engineer assignment, drag-and-drop)
- Engineer mobile-optimized work-order view

## Phase 3 — Insights & Billing
- Reporting (PDF generation per work order / asset / client)
- Dashboarding (real widgets, per-role, configurable)
- Stripe billing integration, `organization_features` sync
- Invoicing flows (Finance / Administratie)

## Phase 4 — Premium polish
- Feature-flag admin UI (Platform Admin toggles modules per tenant)
- Performance pass (streaming, caching, bundle size)
- Notifications, audit log, onboarding wizard
- Multi-view persistence per user, saved filters

## GitHub setup
- Two repos: main app + separate `design-system` repo
- Project board columns: **Backlog → Ready → In Progress → In Review → Done**
- Labels: `phase:0..4`, `module:clients|assets|contracts|planning|reporting|dashboard`, `role:admin|owner|planner|engineer|finance|administratie`
- One issue per feature slice, sized to fit a single subagent task — don't create issues bigger than "one agent, one PR"
