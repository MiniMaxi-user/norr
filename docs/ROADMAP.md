# Roadmap

Phasing decided pragmatically: get multi-tenant auth, RBAC, and the premium app shell right before any business module — every later module depends on it. Widened 2026-08-23 (see `docs/BUSINESS-PLAN.md` §4) once it became clear the original 6-module list was too thin for the "premium FSM SaaS" vision — the phases below are the fuller vision, still built incrementally, one feature slice at a time.

## Phase 0 — Foundation
- Next.js + Supabase scaffold, CI/CD to Vercel (preview deployment per PR)
- `organizations`, `memberships`, baseline RLS, auth flows (signup, invite, login)
- RBAC permission layer (`lib/rbac`)
- App shell: collapsible nav, command palette, theming from `@yourorg/ui` (even a v0.1 of that package)
- GitHub project board + issue templates (see below)

## Phase 1 — Core CRM
- Clients module (CRUD, list/kanban views)
- **Contacts** — multiple contact persons per client, each with a configurable role
- Sites/Locations (already the `sites` table — multiple physical locations per client)
- Assets module (CRUD, linked to clients/sites, list/map views), including configurable **dependent** reference lists (e.g. Asset Sub-type depends on Asset Type) and document/attachment support
- Dashboard shell (layout only, widgets come in Phase 3)

## Phase 2 — Operations core
- **Work Orders** — first-class entity (today only implicit inside Planning): full status lifecycle, linked client/site/asset/engineer/contract, notes/photos/signature
- Contracts module (CRUD, linked assets, SLA terms, entitlements/renewal)
- Planning/Dispatch module (calendar + kanban + list + map, engineer assignment to Work Orders, drag-and-drop)
- **Checklists / inspection forms** — configurable templates attached to a Work Order type
- **Time tracking** — clock in/out per Work Order + travel time
- Engineer mobile-optimized work-order view

## Phase 3 — Money & insights
- **Quotes/Estimates** — proposal builder, convert to a Work Order/contract on approval
- **Invoicing** — elevated from a Finance/Administratie task to a real module: generate from completed Work Orders/contracts, payment status, export
- Reporting (PDF generation per work order / asset / client; first-time-fix rate, technician utilization, contract profitability)
- Dashboarding (real widgets once Work Orders exist to power them, per-role, configurable)
- Stripe billing integration, `organization_features` sync

## Phase 4 — Customer & field experience
- **Customer Portal** — the tenant's own customers: view Work Order status/history, approve quotes, pay invoices
- **Notifications** — automated SMS/email (technician ETA, job done, invoice due), internal @mentions on a Work Order
- **Preventive maintenance / Service Plans** — recurring maintenance schedules per asset/contract, auto-generates Work Orders ahead of due dates
- **Inventory / Parts management** — stock per warehouse/van, parts consumed per Work Order, reorder thresholds
- Feature-flag admin UI (Platform Admin toggles modules per tenant)

## Phase 5 — Scale & extensibility
- **Multi-location/franchise** — a tenant operating multiple branches/depots, roll-up reporting across them
- **Integrations** — accounting/calendar/mapping connectors
- **Knowledge base** — shared procedures/documentation per asset type, accessible to engineers in the field
- Performance pass (streaming, caching, bundle size)
- Audit log, onboarding wizard, multi-view persistence per user, saved filters
- **IoT / remote monitoring** — long-range vision item, not yet scheduled; named here so it isn't forgotten, not because it's near-term

## GitHub setup
- One repo: `@yourorg/ui` lives in-repo at `packages/ui` as an npm workspace package, not a separate repo — see `docs/ARCHITECTURE.md`'s "Design system consumption"
- Project board columns: **Backlog → Ready → In Progress → In Review → Done**
- Labels: `phase:0..5`, `module:clients|assets|contacts|contracts|planning|work-orders|checklists|time-tracking|quotes|invoicing|reporting|dashboard|customer-portal|notifications|preventive-maintenance|inventory|integrations|multi-location|knowledge-base`, `role:admin|owner|planner|engineer|finance|administratie`
- One issue per feature slice, sized to fit a single subagent task — don't create issues bigger than "one agent, one PR". This matters more now that the module list is bigger, not less: the width of the vision lives in this roadmap and the project board's Backlog, never in one oversized PR.

## Backlog authoring — who writes what (as of 2026-08-24)
The product owner authors backlog stories directly (title + description/context + an explicit Acceptance Criteria checklist), using the "User Story" issue template (`.github/ISSUE_TEMPLATE/user-story.yml`). Claude Code implements against a story's acceptance criteria — see CLAUDE.md rule 7. A handful of earlier issues (the Phase 3-5 module list added 2026-08-23) were written by Claude during the vision-expansion pass and don't yet have acceptance criteria — they stay in **Backlog** (not **Ready**) as rough scope notes/context, not build-ready, until the product owner rewrites them with acceptance criteria or explicitly promotes them.
