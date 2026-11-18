# Handoff: Melding (Activity) detailpagina — optie 2a

## Overview
De melding (activity) heeft vandaag **geen eigen route**: `app/(app)/activities/components/activities-table.tsx` opent een rij in `ActivityFormPanel` (slide-in popup), waardoor client, asset, contact, type en omschrijving alleen achter een popup te zien zijn. Deze handoff beschrijft een **volledige detailpagina** `/activities/[id]` die al die data op het oppervlak zet, gebouwd op Pattern A uit `docs/DESIGN-SYSTEM.md` — dezelfde vorm als `work-orders/[id]`.

Doelen van het ontwerp:
1. Geen kerndata meer achter een popup.
2. Brede, half-lege blokken vervangen door twee kolommen met echte inhoud.
3. De details die alleen in `ActivityFormPanel` bestonden (de type-tiles met iconen, en de contactvelden Name/Phone/Email) staan nu op de pagina.

## About the Design Files
De bestanden in dit pakket zijn **design references in HTML** — prototypes die laten zien hoe de pagina eruit moet zien en zich moet gedragen. Het is **geen productiecode om te kopiëren**. De opdracht is deze pagina na te bouwen in de bestaande omgeving van de repo: Next.js 15 App Router, Server Components by default, en **uitsluitend `@yourorg/ui` componenten en tokens** (CLAUDE.md regel 4: geen ad-hoc CSS, geen one-off styled components). Elke inline `style="…"` in de HTML-referentie is er alleen omdat het prototype geen React-componenten kan importeren; in de echte implementatie hoort daar het corresponderende `@yourorg/ui` component of een `Stack`/`Inline` te staan.

`styles.css` in dit pakket is een verbatim kopie van `packages/ui/src/styles.css` uit de repo, alleen meegeleverd zodat de referentie lokaal rendert.

## Fidelity
**High-fidelity.** Alle kleuren, type, spacing en radii komen uit `packages/ui/src/styles.css`; alle markup is overgenomen uit de echte componenten in `packages/ui/src/components/`. Er zijn **geen nieuwe kleuren, tokens of componenten** geïntroduceerd. Bouw pixel-perfect na met de bestaande componenten — niet met eigen CSS.

## Screens / Views

### Melding detail — `/activities/[id]`
**Purpose**: een melding bekijken, corrigeren en er een werkorder van maken.

**Route/data**: nieuwe route `app/(app)/activities/[id]/page.tsx`, patroon gelijk aan `app/(app)/work-orders/[id]/page.tsx`: session + `hasFeature` + `canAccessModule` gate, `getActivity(id)` (bestaat nog niet — toevoegen naast `listActivities` in `app/(app)/activities/actions.ts`), daarnaast `getClient`, `getAsset`, `listOrgMembers`, en de gelinkte werkorders. `readOnly = !canEdit` verbergt elke edit-affordance (nooit een disabled control die RLS alsnog afwijst).

**Layout** (van boven naar beneden, binnen `.ui-app-layout-content`, verticale gap `1.5rem`):

1. **`RecordHeroBand`** — full-bleed donkere band, **eerste** element van de pagina-content (sibling vóór elke `Card`), zodat de negatieve margin de page-inset opheft.
   - Geen `badges`-rij, geen `stats`-strip, geen `recordLabel`/`topRight` (de breadcrumb in de Topbar zegt al "Meldingen / Storing").
   - `title`: `<h1 class="ui-record-hero-band-title">` met de melding-titel (`Storing`), of het inline-editable `input` (`ui-record-hero-band-title-input`) wanneer `!readOnly`.
   - `meta` (in deze volgorde): (a) `ui-record-hero-band-meta-badges` met status-badge (`Badge color={activity_status.color} variant="muted"`) + type-badge, (b) `Building2` + clientnaam, (c) `Clock` + "Open sinds 4h 18m".
   - `actions`: alleen een kebab (`IconButton variant="ghost"` met `MoreVertical`) met daarin Delete. **Geen "Create work order"-knop in de hero** — die actie hoort bij de sectie Linked work orders.
   - Extra: `padding-bottom: 1.625rem` op de band, omdat er geen stat-strip is die de onderrand vormt. Doe dit met een modifier/prop in het design system, niet met een inline style in de app.
2. **Relation cards** — `display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:1rem`, elk een `RelationCard`:
   - Client — icon `Building2`, eyebrow "Client", title `<Link>` naar `/clients/[id]`, subtitle "KvK 30146980 · Kade 12, Groningen", Edit-pencil opent de client-picker popup.
   - Asset — icon `Boxes`, eyebrow "Asset", title `<Link>` naar `/assets/[id]`, subtitle "Printer / MFP · Kantoor 1e verdieping".
   - Contact person — icon `Phone`, eyebrow "Contact person", title "Anne Smit", subtitle "Wie er over deze melding gebeld wordt".
3. **Twee kolommen** — `display:grid; grid-template-columns:minmax(0,1.15fr) minmax(0,1fr); gap:2rem; align-items:start`. Elke sectie is een **flat section** (`SectionHeader` = icoon + serif titel + divider + acties), zonder card-frame eromheen.

   **Linkerkolom** (onderling `1.75rem` gap):
   - **Type** — `SectionHeader` icon `AlertTriangle`. Daaronder `IconTileSelect` met exact de vijf `activity_type` opties en hun `reference_list_items.icon`: Bel activiteit (`Phone`), Storing (`AlertTriangle`, geselecteerd), Onderhoud (`Settings`), Afspraak (`CalendarDays`), E-mail opvolging (`Mail`). Onder de tiles de hulpregel "Asset is required for Storing or Onderhoud activities." (`var(--ui-text-xs)`, `var(--ui-muted)`). Tiles resolven via `resolveActivityTypeIcon` uit `app/(app)/activities/icon-map.ts` — niet hardcoden.
   - **Assignment** — `SectionHeader` icon `FileText`. Een `Textarea` (`rows=2`) met de omschrijving, inline opslaan on blur. Daaronder een `KeyValueList`: Action holder (`Avatar` size sm + naam), Reported at ("Sep 2, 2026, 12:42 PM" via `formatDateTime`), Reported by.
   - **Notes** — `SectionHeader` icon (drie lijnen) + actie `Button variant="primary" size="sm"` met label `+ Note`. Inhoud: `Callout` (warning-getint) met de notitietekst.

   **Rechterkolom** (onderling `1.75rem` gap):
   - **Contact person** — `SectionHeader` icon `Phone`. Drie velden naast elkaar (`grid-template-columns:repeat(3,minmax(0,1fr)); gap:0.75rem`) via `FormField`: Name, Phone, Email — exact de velden uit `ActivityFormPanel`. Hulpregel eronder: "Overgenomen van de contactpersoon bij de client — hier aanpassen geldt alleen voor deze melding."
   - **Linked work orders (N)** — `SectionHeader` icon `ClipboardList` + actie `Button variant="primary" size="sm"` `+ Work order` (dit is de enige plek waar een werkorder wordt aangemaakt; vult client/asset voor uit de melding, zoals `create-quote-actions`/`work_orders_source_activity_id` al doen). Per werkorder een `RowCard`: **badge eerst**, dan titel-link + `WO-…` + planningsstatus, dan twee `Button variant="outline" size="sm"`: **Plan** en **Open**.
   - **Historie** — `SectionHeader` icon `Clock`, inhoud een `KeyValueList` waarvan het label **datum én tijd** toont ("Sep 2, 2026, 12:42 PM · Melding aangemaakt") en de waarde de actor of het gelinkte record.

**Empty states**: geen werkorders → `EmptyState` met de `+ Work order`-actie; geen notities → laat de Notes-sectie weg in plaats van een leeg kader.

## Interactions & Behavior
- **Alles inline, per sectie.** Geen pagina-brede form-popup. Titel is inline-editable in de hero; omschrijving is een textarea die on blur opslaat; relaties worden per kaart via een kleine section-scoped popup gewisseld (zelfde patroon als `WorkOrderRelationsDialog`). Dit is de kern van de redesign — bouw dit niet terug naar één modal.
- **Type wisselen** valideert direct: bij Storing/Onderhoud zonder asset blijft de asset-verplichting staan (bestaande regel in `app/(app)/activities/schema.ts`).
- **`+ Work order`** navigeert naar de nieuwe werkorder (of maakt hem aan en navigeert), en de melding blijft daarna in de Linked-lijst staan.
- **Plan** opent de planning van die werkorder; **Open** navigeert naar `/work-orders/[id]`.
- `readOnly`: pencils, textarea-editing, en de `+`-acties verdwijnen volledig.
- Slide-in popup blijft bestaan **voor aanmaken** (`docs/DESIGN-SYSTEM.md`, "Slide-in popups stay slide-in popups"); alleen bekijken/bewerken verhuist naar deze pagina. `?activityId=…` deep links uit de werkorder-Assignment moeten na deze wijziging naar `/activities/[id]` gaan.

## State Management
Server Component haalt melding + relaties op; client-leaf per sectie (`"use client"`) houdt lokale draft-state en roept een Server Action aan (`updateActivity`, patch per sectie). Zelfde conventie als `WorkOrderScreen`: keyed op `activity.updated_at`, zodat een geslaagde save remount met de opgeslagen waarden en er geen stale draft achterblijft. Geen navigatie na opslaan.

## Design Tokens
Allemaal al aanwezig in `packages/ui/src/styles.css` — niets nieuws:
- Kleuren: Fjord `#1f3540` (hero-band, ink), Snö `#dfe4e0` (tekst op donker), Mässing `#c79a3e` (`--ui-accent`, primaire knop en geselecteerde tile), page canvas `--ui-page-bg` `#eff2ed`, borders `--ui-border` `#dfe4e0`, muted tekst `--ui-muted` `#61716b`, warning-tint voor de Open-badge en de Callout.
- Type: `--ui-font-serif` (Georgia-stack) voor hero-titel en sectietitels, `--ui-font-sans` voor de rest; `--ui-text-xs` … `--ui-text-2xl`; `html { font-size: 90% }` bepaalt de globale dichtheid.
- Spacing: `--ui-space-xs/sm/md/lg/xl`; page-inset `2rem / 2.5rem`; sectiegap `1.5rem`, kolomgap `2rem`, kolom-interne gap `1.75rem`.
- Radii: `--ui-radius-sm/md/lg/xl/full`. Schaduwen: `--ui-shadow-xs/sm/md/lg`.

## Assets
Geen nieuwe assets. Alle iconen zijn bestaande exports uit `packages/ui/src/icons.tsx` (`AlertTriangle`, `Phone`, `Settings`, `CalendarDays`, `Mail`, `Building2`, `Boxes`, `ClipboardList`, `Clock`, `FileText`, `Pencil`, `MoreVertical`). De inline SVG's in de HTML-referentie zijn kopieën van diezelfde glyphs — gebruik in de app de componenten.

## Files
- `MeldingDetail.dc.html` — de referentiepagina (optie 2a), inclusief app-shell.
- `NorrSidebar.dc.html` / `NorrTopbar.dc.html` — bestaande chrome, **ongewijzigd**; alleen meegeleverd zodat de referentie in context staat. Niet nabouwen.
- `styles.css` — verbatim kopie van `packages/ui/src/styles.css`.
- `support.js` — runtime van het prototype; niet relevant voor de implementatie.

Repo-bronnen waar dit ontwerp op is gebaseerd: `docs/DESIGN-SYSTEM.md`, `app/(app)/work-orders/[id]/page.tsx`, `app/(app)/work-orders/components/work-order-hero.tsx`, `app/(app)/activities/components/{activities-table,activity-form-panel}.tsx`, `app/(app)/activities/icon-map.ts`, en `packages/ui/src/components/{record-hero-band,relation-card,section-header,key-value-list,row-card,icon-tile-select,form-field,card,badge,button}.tsx`.
