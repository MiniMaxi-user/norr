# Implementatie — Norr field PWA (mobiel)

Referentie-ontwerp: `Norr Field App.dc.html` (sectie **2a** = prototype, **3a** = gedrag van de bottom bar).
Doel: monteur-PWA met één overzicht (Today) en één werkorder-detail, volledig met de duim te bedienen.

---

## 1. Scope

| Route | Inhoud |
| --- | --- |
| `/` → `/today` | Dagoverzicht: zoeken, statusfilters, "Now"-kaart, "Later today"-lijst |
| `/work-orders/[id]` | Detail met secties `details` (default), `hours`, `articles`, `photos`, `sign` |

Secties zijn **geen aparte routes met eigen pagina-shell** maar tabs binnen het detail. Gebruik een query param zodat de bottom bar deep-linkbaar is en back werkt:
`/work-orders/WO-2418?section=hours`.

---

## 2. Design tokens

Kom uit `packages/ui/src/styles.css`. Gebruik de bestaande CSS-variabelen; onderstaande hexwaarden staan er alleen om het ontwerp te kunnen nalopen.

| Rol | Waarde |
| --- | --- |
| App-achtergrond | `#14252c` |
| Kaart / verhoogd vlak | `#1a2e36` |
| Ingedrukt / input-veld | `#0f1d23` |
| Rand | `#2f4952` (sterk), `#22333b` (binnen kaart) |
| Tekst primair | `#dfe4e0` |
| Tekst secundair | `#93a29c` |
| Tekst tertiair / label | `#6f8078` |
| Accent (Mässing) | `#c79a3e`, tekst daarop `#1f3540` |
| Positief | `#8fbf85` |
| Urgent / destructief | `#e08476` |

Type: kopjes in de serif uit het design system (`Georgia` als fallback), UI-tekst in de system sans.
Label-stijl: `11px`, `letter-spacing .13em`, uppercase, kleur tertiair.
Radii: kaart `18–20px`, knop `12–14px`, pill `999px`.
Cijfers in timers en urenlijsten: `font-variant-numeric: tabular-nums`.

Iconen uit `packages/ui/src/icons.tsx` (stroke `1.75`, `round` caps). Geen nieuwe icon-set toevoegen.

---

## 3. Bottom bar — het kernpatroon

Twee zones, gescheiden door `1px solid #22333b`.

**Zone A — Today (altijd zichtbaar, vast).**
- `width: 86px`, `flex: 0 0 auto`, staat links en scrollt nooit mee.
- Heeft zichtbaar een eigen kader — dit is het enige menu-item dat er als "default bestemming" uitziet:
  - actief (je bent op Today): rand `#c79a3e`, vulling `rgba(199,154,62,.16)`, tekst `#c79a3e`
  - inactief: rand `#2f4952`, vulling `#1a2e36`, tekst `#93a29c`
- Icoon + label, altijd één tap terug naar het overzicht.

**Zone B — contextitems (alleen in een werkorder).**
- Rendert **uitsluitend** als er een werkorder open is. Op Today staat hier één regel hulptekst (`#93a29c`) in plaats van uitgegrijsde items. Geen disabled tabs.
- Items: `Work · Hours · Articles · Photos · Sign off`.
- `overflow-x: auto` + `scroll-snap-type: x mandatory`, items `scroll-snap-align: start`, `min-width: 72px`, `flex: 0 0 auto` — zo kunnen er later secties bij (Checklist, Signatures) zonder dat bestaande targets krimpen.
- Scrollbar verbergen, anders eet die de hoogte op:
  ```css
  .nav-scroller { scrollbar-width: none; -ms-overflow-style: none; }
  .nav-scroller::-webkit-scrollbar { width: 0; height: 0; }
  ```
- Actief item: gouden streepje (`22×3px`, radius `999px`) boven het label + label in `#c79a3e`. Inactief streepje `#2f4952`.

**Maten en reach.**
- Elk target minimaal `56px` hoog (alle tap-targets in de app minimaal `44px`).
- Bar: `padding: 8px 0 24px` (onderste 24px is safe-area; gebruik `env(safe-area-inset-bottom)`).
- `position: fixed; bottom: 0`, achtergrond `rgba(15,29,35,.94)` + `backdrop-filter: blur(14px)`.
- Scroll-containers krijgen `padding-bottom: 104px` zodat de laatste rij niet onder de bar valt.

---

## 4. Detailpagina

Volgorde op het scherm:
1. Statuspill + ordernummer/tijd.
2. Titel (serif) + klant · adres.
3. **Timerkaart, `position: sticky; top: 0`** — blijft in beeld bij scrollen, dus start/stop is altijd één tap.
   - Loopt er iets: kaart in accent `#c79a3e` met tekst `#1f3540`; label "Work time running" / "Travel time running", eronder de grote teller `H:MM:SS`.
   - Staat alles stil: kaart `#1a2e36`, label "Timer paused · total today", teller toont het totaal.
   - Rechts twee knoppen onder elkaar: `Start/Stop work` en `Start/Stop travel`, beide minimaal `44px`.
   - Derde regel: `Travel 0h 32m · Work 1h 14m`.
4. De sectie-inhoud die bij het actieve bottom-bar-item hoort.

Secties:
- **Work** — Location (met Navigate + Call contact), Asset (naam + `AS-xxxx`, plek, bouwjaar), Description, en een contractblok in accent-tint.
- **Hours** — gelogde regels (`Travel` / `Work` pill, tijdvak, duur), totaal in de header, subtotalen onderaan. Lege staat: één regel "Nothing logged yet · 0h 00m". Tekst eronder: tijden komen uit de timer, tikken op een regel is corrigeren.
- **Articles** — regels met aantal-blokje (`36×36`), naam, artikelcode, verwijderknop (`44×44`). Onderaan "Add article" → bottom sheet met catalogus; nogmaals tikken verhoogt het aantal.
- **Photos** — "Take photo" als grote dashed knop, foto's hangen aan de werkbon.
- **Sign off** — samenvatting (uren, artikelen, monteur), daaronder een canvas voor de handtekening, `Clear` + primaire actie. Knoptekst: `Finish work order` zolang er niet getekend is, daarna `Send work receipt` en pas dan in accent.

---

## 5. Statemodel — timers per werkorder

Dit is de plek waar het snel fout gaat. Uren horen bij een order, niet bij de app.

```ts
type Clock = {
  travelStart: number | null; // epoch ms, null = niet lopend
  travelMs: number;           // opgebouwd, exclusief lopende periode
  workStart: number | null;
  workMs: number;
};

type State = { clocks: Record<WorkOrderId, Clock> };
```

Regels:
- Verstreken tijd = `base + (start ? now - start : 0)`. Nooit een teller in een interval optellen; alleen `now` elke seconde verversen zodat het herrekent. Zo overleeft het een gesloten app of een slapende tab.
- **Maximaal één order loopt.** Bij het starten van een timer: sluit eerst elke lopende periode op álle andere orders af (`ms += now - start; start = null`).
- Binnen één order sluiten `travel` en `work` elkaar uit: start je work terwijl travel loopt, dan wordt travel afgesloten.
- `Finish` sluit de lopende periodes van die order af en gaat terug naar Today.
- De interval hoeft alleen te tikken als er daadwerkelijk iets loopt.

**Persistentie.** Schrijf `clocks` naar IndexedDB via de bestaande offline-laag (`apps/pwa/lib/offline/db.ts`), niet naar component-state alleen. Elke start/stop is een muterende actie die in de outbox hoort en later gesynct wordt; de UI leest optimistisch uit de lokale store. Wat je moet opslaan is een reeks periodes (`{kind, startedAt, endedAt}`), niet een opgetelde duur — anders kan de backend niet corrigeren en heb je geen audittrail.

---

## 6. Today-overzicht

- **"Now"-kaart** = de order met een lopende timer; is er geen, dan de eerst volgende order die niet `Signed` is. Nooit "de laatst geopende order" — dat maakt de lijst onlogisch.
- **"Later today"** = alle overige orders, gesorteerd op geplande tijd. Een `Signed` order krijgt `opacity .55`, groene check-pill en zijn werkelijke totaaltijd als subregel.
- Zoeken filtert op titel, klant, adres en ordernummer. Filters: `All · Planned · In progress · Signed`, als pills van `44px` hoog, horizontaal scrollbaar met verborgen scrollbar.
- Statuskleuren: In progress → groen, Urgent → rood-tint, Planned → neutraal, Signed → accent-tint.
- Onderaan een syncregel ("Synced 09:12 · pull to refresh"). Koppel dit aan de echte sync-status; offline hoort hier zichtbaar te zijn, niet in een toast.
- Profielknop rechtsboven (`44×44`, initialen) opent een bottom sheet met uren deze week, sync-status, versie en de logout-knop. Logout zit dus niet in de bottom bar.

---

## 7. Bestanden in de repo

| Wat | Waar |
| --- | --- |
| Overzichtslijst | `apps/pwa/app/(app)/workitems/work-items-list.tsx` |
| Data voor vandaag | `apps/pwa/app/api/workitems/today/route.ts` |
| Offline store / outbox | `apps/pwa/lib/offline/db.ts` |
| Detail-onderdelen (desktop, hergebruik logica) | `app/(app)/work-orders/components/work-order-hero.tsx`, `work-order-hours-section.tsx` |
| Tokens en iconen | `packages/ui/src/styles.css`, `packages/ui/src/icons.tsx` |

Nieuw toe te voegen (voorstel): `apps/pwa/app/(app)/_nav/bottom-bar.tsx`, `apps/pwa/app/(app)/work-orders/[id]/timer-card.tsx`, `apps/pwa/lib/time/clocks.ts` (het statemodel uit §5, los te testen).

---

## 8. Afvinken

- [ ] Elk tap-target ≥ 44px, bottom-bar-items ≥ 56px.
- [ ] Today is altijd zichtbaar en visueel afwijkend van de contextitems.
- [ ] Contextitems bestaan niet buiten een werkorder (niet disabled — afwezig).
- [ ] Contextzone scrollt horizontaal, zonder zichtbare scrollbar, met snap.
- [ ] Timerkaart blijft sticky bij scrollen.
- [ ] Twee orders openen laat twee verschillende urenstanden zien.
- [ ] Timer loopt door na herladen en na een uur in de achtergrond.
- [ ] Start/stop werkt zonder netwerk en komt in de outbox.
- [ ] Tekst op de donkere achtergrond haalt 4.5:1 (secundair `#93a29c` is de ondergrens, `#6f8078` alleen voor labels op kaartniveau).
- [ ] Safe-area onderaan gerespecteerd op iPhone met homebar.
