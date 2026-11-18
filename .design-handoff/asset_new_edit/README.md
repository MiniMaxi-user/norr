# Handoff: Asset new/edit page (mijnNorr)

## Overview
Fullscreen page for creating and editing an **Asset** in the mijnNorr application. One route handles both states (`/assets/new` and `/assets/[id]/edit`); the difference is prefilled values, title, breadcrumb, save-button label and the presence of Delete / Linked records. The layout follows the existing Work Order detail page (dark hero, relation cards with pencil affordance, flat form sections).

Three directions are included. Pick one; they share the same field set.

## About the design files
The files in `design-files/` are **design references written in HTML** — prototypes showing the intended look and behaviour, not production code to copy. Recreate them in the mijnNorr codebase (Next.js App Router + React + the existing `@norr/ui` component library and Tailwind/CSS tokens), reusing existing components (`Card`, `Button`, `Select`, `Input`, `Textarea`, `Badge`, page shell) rather than porting the inline styles. The sidebar and topbar in the mocks are reproductions of the existing app shell — do not rebuild them, mount the page inside the current shell.

The HTML uses a small internal component runtime (`support.js`); ignore it. Read the markup for structure, values and copy only.

## Fidelity
**High-fidelity.** Colours, type sizes, spacing and copy are final-intent. Match them, but always prefer the equivalent existing token/component in the codebase over a literal hex value — the hex list below is the reference for what those tokens should resolve to.

## Fields (source of truth: repo)
Taken from `app/(app)/assets/schema.ts` and `app/(app)/assets/components/asset-form-dialog.tsx`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| clientId | relation | yes | search by name / KvK; sets available sites |
| siteId | relation | yes | primary visit address prefills after client pick |
| name (Asset ID) | text, max 200 | no | blank → next sequential id per organisation (`AST-00042`) |
| serialNumber | text, max 200 | no | |
| typeId | ref data | yes | drives sub-type list |
| subtypeId | ref data | no | cleared when it no longer matches Type |
| brandItemId (Manufacturer) | ref data | no | |
| modelId | ref data | no | filtered by Type + Manufacturer; picking a model fills Type and Manufacturer, and sets warranty default |
| statusId | ref data | no | empty → org default (Active) |
| externalReference | text, max 200 | no | ERP / legacy id |
| installedAt | date | no | |
| warrantyUntil | date | no | model default = install + 36 months |
| notes | text, max 5000 | no | 3-row textarea |

Reference data (types, sub-types, brands, models, statuses) is tenant-configurable. When a list is empty, show an inline hint with a link to Settings instead of an empty dropdown.

## Screens / views

### A — `Asset New-Edit.dc.html` (recommended: form-first)
Purpose: fast create and full edit in one page.

Layout, top to bottom inside the app shell:
1. **Dark hero** — `background #16262e`, padding `24px 36px 22px`. Title in serif `34px/400`, colour `#f6f8f5` (`AST-28383` in edit, `New asset` in new). 1px `#2f4952` divider (`max-width 930px`), then a meta row (`gap 14px`, `13px`, `#93a29c`): status pill, mode pill (`Editing` / `Draft`), map-pin + site, calendar + install date. Right side: primary Save (`#c79a3e` bg, `#16262e` text, `10px 18px`, radius 8), ghost Cancel (`1px #3e5c64` border), and in edit only a Delete button (`1px #7e4034` border, `#e08476` text).
2. **Relation cards** — 2-column grid, `gap 18px`, on the `#eff2ed` page background. White card, `1px #dfe4e0`, radius 12, padding `14px 16px`, shadow `0 1px 2px rgba(31,53,64,.04)`. Uppercase 10px `#82918a` label with a 12px icon and a red asterisk; value `16px/600`; sub-line `12.5px #82918a`. **No dropdown** — a pencil icon button top-right (28×28, radius 7, hover `#eff2ed`) opens the existing entity picker; chevron bottom-right expands details.
3. **Form column + right rail** — grid `minmax(0,1fr) 340px`, gap 24. Sections `Equipment`, `Status & warranty`, `Notes`, each headed by a 16px line icon + `15.5px/600` title + a 1px `#dfe4e0` rule filling the row. Fields in a 2-column grid, `gap 16px 20px`; label `12.5px/600 #485754`, control height 38, `1px #c7cec7`, radius 8, white; helper text `11.5px #82918a`.
4. **Right rail** — Summary card (Asset ID / Type / Model / Warranty), and in edit only: Linked records (work orders 4, contracts 1, activiteiten 2, plus a gold `New activity` button) and Record card (created / last modified). Amber info card `#fbf6ea` / `1px #ecd9ac` / text `#8a6522` about tenant-configurable reference data.
5. **Sticky footer bar** — white, `1px #dfe4e0` top border, padding `12px 36px`: left a save-state line (`All changes saved` / `Unsaved changes` / `Required: Client, Site, Type`), right Cancel + primary save.

### B — `Asset New-Edit v2.dc.html` (light, section-navigated)
No dark hero. White page header (`1px #dfe4e0` bottom) with a 44px rounded icon tile, serif `25px` title, status pill + type + client/site line, and save actions right. Body is centred at `max-width 1180px` with a sticky left in-page nav (`200px`, active item `2px #c79a3e` left border on white) and a single column of white cards (radius 14, padding `20px 22px`): Relations, Equipment, Status & warranty, Notes, Record. Fields use a `180px / 1fr` label-left grid. Status is a pill radio group instead of a select. Best when the form gets longer.

### C — `Asset New-Edit v3.dc.html` (detail-first, inline edit)
Mirrors the Work Order detail page: dark hero + a 4-column KPI strip inside the hero (Model, Serial, Warranty with a progress bar, Work orders count), separated by `1px #2f4952`. Below it a 4-up relation card row (Client, Site, Model, Contract), each with a pencil. Then two columns of read-only key/value cards with a pencil per section header; the pencil swaps that section into an inline edit card (border `#c79a3e`, Cancel + Save inside the card). Right column: Notes, `Recent activities` (rows badged `Activity` / `Workorder`), created/modified footnote. Best for an asset that mostly gets read, occasionally corrected.

## Interactions & behaviour
- **Client → Site**: choosing a client resets the site and prefills its primary visit address.
- **Model → Type/Manufacturer/Warranty**: picking a model sets Type and Manufacturer and proposes `installedAt + 36 months` as `warrantyUntil` (only when the user has not typed one).
- **Type → Sub-type**: changing Type clears a sub-type that does not belong to the new type.
- **Asset ID**: placeholder communicates auto-generation; leave empty to let the server assign.
- **Pencil buttons** open the existing search/select dialog for that relation; nothing is edited in place in variants A and B.
- **Dirty state**: any input/change flips the footer label to `Unsaved changes`; Save resets it. Block navigation on dirty (existing unsaved-changes guard).
- **Validation**: Client, Site, Type required; inline error under the field plus footer summary. Max lengths per the table above.
- **Delete**: edit only, opens the standard destructive confirm dialog.
- **Hover**: primary button `#c79a3e → #b0872f` (`#d8ad5c` on the dark hero); ghost border `#3e5c64 → #61716b`; icon buttons get `#eff2ed` background; nav items `#223a43`.
- **Focus**: `2px solid #c79a3e`, offset 1px, on every control.
- Layout is desktop-first (≥1280). Below ~1100 the right rail stacks under the form and the relation cards go single-column.

## State
`mode: "new" | "edit"`, form values per the field table, `dirty: boolean`, per-section `editing` flag (variant C only), reference-data lists (types, sub-types filtered by type, brands, models filtered by type+brand, statuses), plus sites filtered by selected client. Fetch reference data server-side on the route; relation pickers query on demand.

## Design tokens (as used in the mocks)
Colors: page `#eff2ed`; surface `#ffffff`; sidebar `#1a2e36`; topbar `#14252c`; hero `#16262e`; hero rule/border `#2f4952`; border `#dfe4e0`; input border `#c7cec7`; text `#1f3540`; label `#485754`; muted `#61716b`; muted-2 `#82918a`; dark text `#dfe4e0` / `#f6f8f5`; dark muted `#93a29c` / `#6f8078`; accent `#c79a3e` (hover `#b0872f`, light `#d8ad5c`); accent text on dark `#d8b46c`; accent ink `#8a6522`; amber surface `#fbf6ea` / border `#ecd9ac`; success `#3c6b41` on `#e8f0e6` / `#c9dcc4`; danger `#c4402f`, dark-mode danger `#e08476` / border `#7e4034`; progress green `#6f9d5f`.

Type: system sans stack for UI; Georgia/serif for page titles and KPI numbers. Sizes 10 (uppercase labels, letter-spacing .13em), 11.5, 12.5, 13, 13.5 (body), 15.5 (section title), 16, 21 (KPI), 25 / 34 (title).

Spacing: 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 22 / 24 / 36 (page gutter). Radius: 7 (icon button), 8 (control/button), 10, 12 (card), 14 (variant B card), 999 (pill). Shadow: `0 1px 2px rgba(31,53,64,.04)`. Control height 38px. Sidebar 224px, topbar 64px, right rail 340px.

## Assets
No images. All icons are inline stroke SVGs in a Lucide-compatible style (24 viewBox, stroke-width 1.7–1.8, round caps) — replace with the app's existing icon library: layout-grid, users, box, file-text, list, wrench, file, bell, bar-chart, euro, sun, shield, panel-left, chevron-right/down, search, moon, help-circle, user, map-pin, calendar, building, printer, shield-check, save, trash, pencil, plus, clock.

## Files
- `design-files/Asset New-Edit.dc.html` — variant A
- `design-files/Asset New-Edit v2.dc.html` — variant B
- `design-files/Asset New-Edit v3.dc.html` — variant C
- `design-files/Norr Sidebar.dc.html`, `design-files/Norr Topbar.dc.html` — shell reproductions (reference only)
- `design-files/support.js` — prototype runtime, not part of the design
