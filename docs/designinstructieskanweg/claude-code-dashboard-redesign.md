# Opdracht voor Claude Code: dashboard-redesign (compact, grafieken centraal)

Plak alles hieronder in Claude Code, in de root van de `norr` repo.

---

## Doel

Herontwerp het dashboard (`app/(app)/page.tsx` + `app/(app)/dashboard/components/dashboard-view.tsx`). Het moet compacter worden en de grafieken moeten centraal staan.

1. Minder scrollen. Nu nemen 2 rijen van 4 `StatCard`s bijna een heel scherm in. Vervang ze door één compacte KPI-strook in de donkere hero-band.
2. De grafieken krijgen de ruimte. Ze worden groter en staan hoger op de pagina, met minder losse panelen.

Dit is een **UI-herindeling van een bestaande pagina**, geen nieuwe module. Er komen geen schema-, RLS- of permissiewijzigingen. Volg wel CLAUDE.md:

- Alleen `@yourorg/ui`-componenten en -tokens gebruiken, geen ad-hoc CSS in de app.
- Wat ontbreekt, voeg je toe aan `packages/ui` met een story.
- Delegeer UI-werk aan `frontend-ui-engineer`.
- Draai daarna typecheck en lint.

Behoud alle bestaande logica:

- `computeDashboard`, cross-filtering (klik op een grafiek of lijst filtert alles), filter-chips en "Clear all"
- URL-sync en het onthouden van de periode in `localStorage`
- `visible.*`-gating, lege staten, de `truncated`-Callout en de `links.*`-checks

## Nieuwe layout (van boven naar beneden)

### 1. Hero-band (`OverviewHeroBand`, donker Fjord)
- **Titel:** "Dashboard". Op dezelfde regel, als subtitel: `{model.rangeLabel} · click any chart to filter`. Laat de lange subtitel van nu vallen.
- **Rechts in `actions`:** de periode-`ViewSwitcher` (30d / 3m / 6m / 12m), verplaatst uit de body naar de band. Hij moet goed leesbaar zijn op de donkere achtergrond: actief = Mässing-vlak met Fjord-tekst.
- **Onder de titel, over de volle breedte: één KPI-strook met 8 tegels.** Gebruik `StatStrip` (die bestaat al voor donkere bands) en breid hem uit in `packages/ui`:
  - optioneel `trend` per item (delta-tekst + richting + `positiveWhen`, kleuren succes/danger in hun "on-dark"-varianten zoals `.ui-overview-hero-band` ze al definieert);
  - optioneel `spark: number[]`: een kleine sparkline van ca. 64×22 (SVG-polyline) rechts naast de waarde;
  - optioneel `group`-label ("Finance" / "Operations") en een iets sterkere scheidingslijn tussen de groepen;
  - responsive: `grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))`, zodat de 8 tegels op desktop op één rij passen en op mobiel netjes wrappen.
- **Tegels.** De waarde is ca. 22px. Label in kleine kapitalen, daaronder één regel delta + korte hint.
  - Finance: Revenue, Gross margin, Draft pipeline, Avg. invoice
  - Operations: Open work orders (hint: "X unscheduled · Y review"), Overdue, Open malfunctions (`positiveWhen: "down"`), Completed (hint: "avg. X d to done")
  - Respecteer `visible.finance`, `visible.workOrders` en `visible.activities`: verberg de tegels die niet zichtbaar mogen zijn.
- **Totale bandhoogte:** ca. 150–170px.

De filter-chips komen direct onder de band, en alleen als er filters actief zijn.

### 2. Rij 1: `Grid columns="2-1"`
- **Links: "Revenue per month".** Dit is de hoofdgrafiek: `ColumnChart`, gestapeld Standard/Contract, met **`height` ≈ 260**.
  - Zet de legenda en het totaal ("€291.4k total") compact in de paneelheader, niet eronder.
  - Toon de lopende maand/dag (partial bucket) gedimd, met label "(MTD)".
- **Rechts:** "Top clients by revenue" (`BarList`), met een link "All clients" in de header.

### 3. Rij 2: drie kolommen (breed / smal / smal)
- **"Work orders created vs completed".** `TrendChart` met area, `height` ≈ 200 en de legenda in de header. Subregel: netto backlog-groei in de range (created − completed).
- **"Work orders by status".** `DonutChart` (`size` ≈ 132) met de legenda **naast** de donut, niet eronder.
- **"Engineer workload".** `BarList`, compacte rijen: naam | balk | aantal op één regel.

Ondersteunt `Grid` geen "2-1-1"? Voeg dan een `GridColumns`-variant `"2-1-1"` toe in `packages/ui` (met dezelfde collapse-regels).

### 4. Rij 3: `Grid columns={3}`
- **"Malfunctions reported".** `ColumnChart`, `height` ≈ 170, met in de subregel het totaal en de delta.
- **"Assets with most malfunctions".** `BarList`; het secondary-label (klant) staat achter de assetnaam.
- **"Mix by type": nieuw, vervangt de 2 losse donuts** "Activities by type" en "Work orders by type". Toon per dimensie een **100%-gestapelde horizontale balk** (14px hoog) met daaronder een 2-koloms legenda (label + aantal).
  - Klik op een segment of legenda-item zet `activityTypeValue` / `woTypeValue`, net als nu.
  - Maak hiervoor een `StackedBar`-component in `packages/ui/src/charts.tsx`, met `chartColor`/`resolveColor`, `selectedKey`/`onSelect` en a11y gelijk aan `DonutChart`. Voeg een story toe.

### 5. Rij 4: `Grid columns="2-1"`
- **Eén paneel met `Tabs` dat de 3 losse lijsten vervangt:** "Next 7 days", "Overdue" en "Oldest malfunctions".
  - Elke tab heeft een teller-badge.
  - De inhoud blijft de bestaande `RecordList`-configuratie: meta-tone danger/warning en links alleen als `links.*` het toelaat.
  - Onderaan staat een link per tab: "Open planning →" / "All overdue work orders →" / "All open malfunctions →".
  - Default-tab: "Overdue" als er overdue items zijn, anders "Next 7 days".
- **Rechts:** "Top-selling lines" (`BarList`, Mässing-kleur), verplaatst vanuit de losse volle-breedte-rij onderaan.

## Paneel-stijl

- Gebruik een compactere variant van de bestaande `Panel` in `dashboard-view.tsx`: titel ca. 15px semibold, een optionele subregel in muted 12px, en legenda/acties rechts in de header (`SectionHeader` `actions`-slot). Geen aparte hint-alinea meer boven elke grafiek.
- De gap tussen rijen en panelen is `md` (16px) in plaats van `lg`.

## Data voor de sparklines

Breid `computeDashboard` in `lib/dashboard/compute.ts` uit met per-bucket reeksen voor de KPI-sparklines. Hergebruik wat al bestaat:

- revenue → uit `revenueSeries`
- completed → uit `flowSeries`
- malfunctions reported → uit `malfunctionSeries`

Voor KPI's zonder zinvolle reeks laat je `spark` weg; de tegel moet ook zonder sparkline goed ogen. Voeg unit-tests toe voor de nieuwe reeksen als `compute.ts` al tests heeft.

## Skeleton

Pas `dashboard-skeleton.tsx` aan op de nieuwe vorm (band + strook + 4 rijen), zodat er geen layout-sprong is bij het laden.

## Acceptatie

- Op 1440×900 zijn de hero-band met alle KPI's **en** de omzetgrafiek volledig zichtbaar zonder te scrollen.
- De totale paginahoogte is duidelijk kleiner dan nu (doel: ca. 1250px of minder op 1440 breed).
- Cross-filtering werkt nog vanuit elke grafiek, lijst en het nieuwe "Mix by type"-paneel.
- Op mobiel (390px) stapelt alles, wrapt de KPI-strook en is er geen horizontale scroll.
- Er zijn geen nieuwe styles in `app/`; alles zit in `packages/ui` (tokens, componenten, stories).
- Typecheck en lint zijn groen.
