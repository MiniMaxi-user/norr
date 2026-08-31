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

**Examples**: Clients, Quotes.

If you're designing a new module and it's genuinely unclear which one fits, ask: *does this page's value come from its own content, or from browsing to its relations?* Content → Pattern A. Relations → Pattern B.

## Card vs. flat section

- A **card** frames something that stands on its own and could be looked at in isolation — a "linked record" summary (Client, Site), a sidebar fact block in Pattern B.
- A **flat section** (icon + title + divider, then rows — no border around the whole thing) is for content that's part of the page's *own* primary surface. Wrapping every such section in its own card reads as boxes-within-a-box — that's exactly why Work Orders' Hours/Material/Checklist/Assignment sections have no card around them.

## Row lists vs. tables

- For a short, glanceable list attached to one record — hours logged, material used, a checklist, a record's own key facts — use a row-list component (a bordered row per item, or a label/value row for facts), not a table with column headers.
- Reserve a real **table** for genuinely tabular, sortable, multi-column data — a contract's linked-assets list, a list-view screen. If a screen needs sorting, filtering, or more than a handful of columns, it wants a table.

## Column / rail layout

- Pattern A stacks its sections in one or two columns, on the plain page background.
- Pattern B uses a fixed sidebar (roughly a third of the width) plus a tab-driven main column.
- Don't mix the two inside one page — a page is either "flat stacked sections" or "sidebar + tabs," not both.

This doesn't apply to a screen that's primarily a wide data grid (a list view with many columns/filters) — those don't take either detail-page treatment; a grid earns its own full width.

## Buttons: default size vs. small

- **Default size** for a page's primary, top-level actions — hero actions (Edit, Delete, Create Quote), a page's own "Create X" button.
- **Small (`size="sm"`)** for anything scoped to a single row, or a small inline "add one more" trigger inside a section — e.g. "+ Travel" / "+ Work" / "+ Article" on a Work Order, a row's own Edit/Delete icons, "Add line item," "Link asset." If it sits next to or inside a list of rows rather than at the top of the page, it's small.

## Slide-in popups stay slide-in popups

Clients, Assets, and Activities create/edit as a slide-in panel from the right (not a full page) — that's a deliberate, product-owner-confirmed choice for those three, unrelated to which detail-page pattern (A or B) the record's own *view* page uses. This round of design-system work only straightens the visual language *inside* those panels where it was touched — it does not convert any of them to a full page, and a full-page top-level module (Contracts, Work Orders, Quotes) should not be converted to a popup either. See `docs/ARCHITECTURE.md`'s "Popup vs. full page" section for the full rule and the three named carve-outs.
