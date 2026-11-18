# Contracts/[id] — indeling 1b, implementatie-instructies

Doel: `app/(app)/contracts/[id]` omzetten naar de indeling van optie 1b
(`Contract detail - 1b.dc.html`). Pattern A volgens `docs/DESIGN-SYSTEM.md`:
donkere hero-band met statstrip, daaronder een brede werkkolom links en een
smalle feitenrail rechts.

Alles hieronder gebruikt bestaande `@yourorg/ui`-componenten. Er zijn geen
nieuwe UI-primitieven nodig; wel één nieuwe prop op `ContractScreen`
(`stats`) en één nieuwe layoutverhouding.

## 1. Hero-band

Bestand: `app/(app)/contracts/components/contract-screen.tsx`

- `RecordHeroBand` krijgt een `stats={<StatStrip items={stats} />}`. Nu heeft
  de contractband géén statstrip, waardoor hij onderaan wegloopt in de pagina —
  de strip vormt de vlakke onderrand van de band (zie de comment in
  `.ui-record-hero-band`).
- Verwijder de `badges`-prop. Type- en SLA-badge gaan naar de **eerste** meta-item,
  gewikkeld in `<span className="ui-record-hero-band-meta-badges">`, precies zoals
  `work-order-hero.tsx` doet. Dat scheelt een hele regel hoogte.
- Meta-rij wordt, in volgorde: badges → klant (`Building2` + link naar
  `/clients/[id]`) → looptijd (`CalendarDays` + `formatDate` start – eind).
- Acties rechts blijven `Delete` (danger). "New quote" is een voorstel, geen
  bestaande actie — laat hem weg tot die flow bestaat.

### StatStrip-items

Bereken in `ContractScreen` uit data die er al is; geef als `StatStripItem[]` door.

| Label | Waarde | Hint |
| --- | --- | --- |
| Contract value | `formatCurrency(contract.value)` | `billing_terms.label` · `billing_period.label` |
| Term remaining | dagen tot `end_date` | progress = verstreken deel van start→eind |
| Line items | `lineItems.length` | `formatCurrency(som van quantity × unit_price)` |
| Covered assets | `contractAssets.length` | aantal unieke sites |

Open einddatum (`end_date === null`): toon "Open-ended" als waarde en laat de
progressbalk weg. Nul line items / nul assets: waarde `0`, geen hint.

## 2. Body-layout

`DetailColumns` gebruikt `minmax(0, 1.15fr) minmax(0, 1fr)`. Voor 1b is de
verhouding ongeveer `1.85fr / 1fr`. Twee opties:

1. Voeg aan `packages/ui/src/components/detail-columns.tsx` een `ratio`-prop toe
   (`"balanced" | "rail"`), met een tweede klasse `.ui-detail-columns-rail`
   naast de bestaande regel in `styles.css`. Voorkeur — houdt het in het systeem.
2. Of gebruik in de pagina één grid met die tracks en laat `DetailColumns` met rust.

Rechterkolom is `align-items: start` zodat de rail niet meerekt met de linkerkolom.

**Links (de werkkolom), in deze volgorde:**
1. `ContractLineItemsSection`
2. `ContractArticleCoverageSection`
3. `ContractAssetsPanel`

**Rechts (de rail), in deze volgorde:**
1. Client-`RelationCard` (verhuist van bovenaan de pagina naar de rail)
2. Terms — samengevoegd blok: Type, SLA Tier, Billing terms, Billing period,
   Value, Auto-renews
3. Dates — Start, End, Created
4. Notes als `Callout` (warning-tint), niet als eigen kaart

## 3. Secties samenvoegen

`ContractDetailsSection` verdwijnt als aparte sectie:

- **Name** stond in de kv-lijst én als hero-titel. Dubbel; laat de kv-rij vallen.
  Naam bewerken gebeurt via de hero-titel (`ui-record-hero-band-title-input`,
  zelfde patroon als work orders).
- **Client** zit al in de `RelationCard`; bewerken blijft via de pencil daar.
- **Type** verhuist naar de Terms-sectie, als eerste kv-rij.

`ContractTermsSection` wordt dus de enige feitensectie met een editcard, en
krijgt Type erbij. Let op: SLA Tier cascadeert op `draft.typeId` — nu die
allebei in dezelfde `EditableSection` zitten, kan de `key={draft.typeId}`-truc
op `CascadingSelect` weg en volstaat het lokale state-veld.

`ContractNotesSection` blijft bestaan maar rendert zijn leesweergave als
`Callout` in plaats van een kaart. Bewerken blijft dezelfde `Textarea`-toggle.

Metadata: "Created" gaat als kv-rij naar Dates. De losse
`<Inline justify="between">` met Created/Last modified onderaan de rechterkolom
verdwijnt.

## 4. ContractAssetsPanel opschonen

Bestand: `app/(app)/contracts/[id]/contract-assets-panel.tsx`

Nu een losse `Card` met `<Heading level={3}>Linked Assets</Heading>` — dat wijkt
af van elke andere sectie op de pagina.

- Vervang door een platte sectie: `SectionHeader icon={Boxes} title="Covered assets"`
  met de add-actie in de `actions`-slot als `variant="primary" size="sm"` met label
  `+ Asset` (design-systeemregel voor add-knoppen in een sectiekop).
- Haal de `Card`-wikkel weg; de `Table` staat direct op de paginaachtergrond,
  net als in work orders.
- De "Link another asset" select + knop verhuizen naar een dialog achter `+ Asset`
  (zelfde vorm als `ContractLineItemDialog`), zodat de sectie niet permanent een
  formulierregel toont.
- Tabel houdt kolommen Asset / Site / Actions. `EmptyState` blijft ongewijzigd.

## 5. Knopvarianten rechtzetten

`ContractLineItemsSection` gebruikt `variant="outline"` voor `+ Article`.
Volgens `docs/DESIGN-SYSTEM.md` ("Rows and tab-panel add buttons") hoort dat
`variant="primary" size="sm"` te zijn. Zelfde voor `+ Rule` in
`ContractArticleCoverageSection`.

## 6. Wat níet verandert

- Per-sectie opslaan via `commitPatch` (geen paginabrede Save/Cancel).
- `mode: "create"` op `/contracts/new` — daar is er geen statstrip, geen
  line items, geen coverage en geen assets. De hero houdt daar zijn
  Cancel/Save-paar en de rail toont alleen Terms + Dates + Notes.
- RBAC: `readOnly`, `canCreate`, `canUpdate`, `canDelete` gedragen zich als nu.
- Breadcrumbs blijven via `usePageHeader` in de Topbar, niet in de band.

## Bestanden die je aanraakt

```
app/(app)/contracts/components/contract-screen.tsx        hero + stats + layout
app/(app)/contracts/components/contract-terms-section.tsx Type erbij
app/(app)/contracts/components/contract-details-section.tsx  verwijderen
app/(app)/contracts/components/contract-dates-section.tsx Created erbij
app/(app)/contracts/components/contract-notes-section.tsx Callout-leesweergave
app/(app)/contracts/components/contract-line-items-section.tsx  knopvariant
app/(app)/contracts/components/contract-article-coverage-section.tsx  knopvariant
app/(app)/contracts/[id]/contract-assets-panel.tsx        platte sectie + dialog
packages/ui/src/components/detail-columns.tsx             ratio-prop (optioneel)
packages/ui/src/styles.css                                .ui-detail-columns-rail
```
