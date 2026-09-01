# Design system guidance — for the UX designer

This is a plain-language companion to `docs/ARCHITECTURE.md` ("Two detail-page header patterns", "Popup vs. full page", "Design system consumption"). It answers "which pattern/component do I design this screen with," without needing to read source code. Written after issue #107, which distilled the Work Orders redesign into the app's canonical design system and brought Assets and Contracts in line with it.

## The two detail-page patterns

Every top-level record (a Client, Work Order, Asset, Contract, Quote, ...) gets one of two header/layout treatments. Pick by what the page is *for*, not by what an existing similar-looking page happened to use.

### Pattern A — operational record
A dark, full-bleed hero band at the top (title, status/type badges, a couple of icon+text facts, actions top-right), then a couple of small "linked record" cards (Client / Site / Asset / Contract — whichever apply), then the record's own content in flat sections — no card frame around them, just an icon + title + a divider line, then rows.

**Use this when the page's job is to show and work with the record's own content** — a compact set of fields, a log of time/material entries, a checklist. The record doesn't have many children to browse; it mostly *is* its own content.

**Examples**: Work Orders (the origin of this pattern), Assets, Contracts.

### Pattern B — relationship-heavy record
A lighter, editorial header (an initials mark, serif name, a dot-separated line of key facts, badges), then a sidebar of small cards plus a tab strip for the record's related lists.

**Use this when the page's job is mainly to navigate the record's own children** — a client's sites, assets, contacts, contracts, quotes, work orders, activities, all reachable as tabs from one screen.

**Examples**: Quotes.

**Clients is a named exception — a hybrid of both**, not a third pattern to reuse elsewhere: its header is Pattern A's dark hero band (with a strip of Sites/Assets/Work Orders/Quotes/Activities counts baked in, since a client's relationships genuinely are header-worthy facts), but its body keeps Pattern B's sidebar + tabs, because a client is also the app's single most relationship-heavy record — it has too many distinct related lists (sites, assets, contacts, work orders, contracts, quotes, activities) for flat sections to serve well. This combination exists because Clients' content needs both halves, confirmed by explicit product-owner direction — don't treat it as a green light to freely mix header/body components on a new page; default to a pure Pattern A or B first.

If you're designing a new module and it's genuinely unclear which one fits, ask: *does this page's value come from its own content, or from browsing to its relations?* Content → Pattern A. Relations → Pattern B. Only reach for the Clients-style hybrid when a record is genuinely both at once, and confirm that with the product owner rather than deciding it alone.

## Overview-page header (issue #116, rollout complete)

Every top-level module's OVERVIEW/list page (Clients, Assets, Contracts, Articles, Work Orders, Quotes, Meldingen) now gets the same dark, full-bleed "blue header" band the detail pages above use — just reshaped for a list page: a page title (e.g. "Customer overview"), an optional small inline stat readout on the right, and a right-aligned `ViewToggle` + primary "Add …" button, instead of a record's badges/facts/assignee. The component is `OverviewHeroBand` — visually the same dark surface and typography as `RecordHeroBand`, but its own smaller shape, since a list page has no single record's title/badges/meta to show. The search/filter row stays a plain light card directly below the band, unchanged.

**All seven pages are now converted.** Clients (List and Kanban both) got the full treatment first — title + the `stats`/`actions` slots (view toggle, "Add client", and Kanban's "Klanten"/"Pipeline potential" readout) — since it's a single client component that can compute those synchronously. Assets (map/list), Contracts, Articles, Work Orders, Quotes, and Meldingen followed with a plain title+subtitle band only: each of those pages streams its toolbar/create-button/view-switcher in asynchronously via its own `*Screen` component inside `Suspense`, so that chrome stayed exactly where it was (below the band, inside the `Suspense` boundary) rather than being pulled into the band's `stats`/`actions` slots.

## Card vs. flat section

- A **card** frames something that stands on its own and could be looked at in isolation — a "linked record" summary (Client, Site), a sidebar fact block in Pattern B.
- A **flat section** (icon + title + divider, then rows — no border around the whole thing) is for content that's part of the page's *own* primary surface. Wrapping every such section in its own card reads as boxes-within-a-box — that's exactly why Work Orders' Hours/Material/Checklist/Assignment sections have no card around them.

## Row lists vs. tables

- For a short, glanceable list attached to one record — hours logged, material used, a checklist, a record's own key facts — use a row-list component (a bordered row per item, or a label/value row for facts), not a table with column headers.
- Reserve a real **table** for genuinely tabular, sortable, multi-column data — a contract's linked-assets list, a list-view screen. If a screen needs sorting, filtering, or more than a handful of columns, it wants a table.

## Column / rail layout

- Pattern A stacks its sections in one or two columns, on the plain page background.
- Pattern B uses a fixed sidebar (roughly a third of the width) plus a tab-driven main column.
- Don't mix the two inside one page — a page's *body* is either "flat stacked sections" or "sidebar + tabs," not both. (Clients pairs a Pattern A *header* with a Pattern B *body* — see the named exception above; that's a header-level hybrid, not a body-level mix of flat sections and a sidebar.)

This doesn't apply to a screen that's primarily a wide data grid (a list view with many columns/filters) — those don't take either detail-page treatment; a grid earns its own full width.

## Buttons: default size vs. small

- **Default size** for a page's primary, top-level actions — hero actions (Edit, Delete, Create Quote), a page's own "Create X" button.
- **Small (`size="sm"`)** for anything scoped to a single row, or a small inline "add one more" trigger inside a section — e.g. "+ Travel" / "+ Work" / "+ Article" on a Work Order, a row's own Edit/Delete icons, "Add line item," "Link asset." If it sits next to or inside a list of rows rather than at the top of the page, it's small.

## Rows and tab-panel "add" buttons — same shape everywhere

Two small conventions that apply to every tab on a relationship-heavy detail page (Clients today; any future record with the same shape), added after the Clients page ("Indeling Clients/id") audit found them inconsistent tab-to-tab.

- **Badge before the label, always.** Any row pairing a name/address with a status badge ("Primary" on a site or contact, a tenant-status line) shows the badge first, then the text — never text-then-badge. One order everywhere means a user can scan a whole tab's rows the same way regardless of which tab they're on.
- **On a dark hero band, badges sit on the meta line, not their own row above the title.** `RecordHeroBand` has a separate `badges` prop that renders as its own row above the title — don't reach for it on a new page. Fold badges into the `meta` row instead, as its first item (wrapped in `ui-record-hero-band-meta-badges`), so they read on the same line as the address/other facts just below the title. Same placement Work Orders uses for its status/priority pair; Clients' Primary/"Client since"/Tenant badges now follow it too.
- **A tab panel's own "add" button lives in a `SectionHeader`, small and primary (yellow).** Give the panel a short title (icon + label, matching the tab's own icon) via `SectionHeader`, and put the "add a related record" action in its `actions` slot as a small primary `+ Label` button (`variant="primary" size="sm"`) — not a bare, unlabeled, full-width button floating above the grid with no heading. Small + `+ Label` mirrors the shape Work Orders uses for "+ Article"/"+ Travel"/"+ Work" — the color stays the ordinary primary/accent (yellow) button, a deliberate reversion from an earlier outline-colored attempt at this same convention. It does not apply to an `EmptyState`'s own action button (nothing to sit beside there) or to a top-level module's own primary "Create X" action (Work Orders' "New Work Order," etc.) — those keep the default-size primary button described above ("Buttons: default size vs. small"). Applied across every tab on Clients now — Sites, Contacts, Assets, Activiteiten, Work Orders, Contracts. **The `SectionHeader` title is still worth giving a tab even when it has no add button** (Quotes) — that's a separate, per-tab product call about whether an add action belongs there at all, not a reason to skip the header shape.

## Slide-in popups stay slide-in popups

Clients, Assets, and Activities create/edit as a slide-in panel from the right (not a full page) — that's a deliberate, product-owner-confirmed choice for those three, unrelated to which detail-page pattern (A or B) the record's own *view* page uses. This round of design-system work only straightens the visual language *inside* those panels where it was touched — it does not convert any of them to a full page, and a full-page top-level module (Contracts, Work Orders, Quotes) should not be converted to a popup either. See `docs/ARCHITECTURE.md`'s "Popup vs. full page" section for the full rule and the three named carve-outs.
