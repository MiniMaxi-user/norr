# FSM SaaS Platform — Businessplan

## 1. Visie
Premium, multi-tenant Field Service Management platform voor technische dienstverleners (installatie, onderhoud, facilitair) die klanten, assets, contracten en planning centraal beheren.

## 2. Doelgroep & probleem
- **Doelgroep**: technische dienstverleners met engineers in het veld — installatie, onderhoud, facility management. 5–500 medewerkers.
- **Probleem**: versnipperd beheer van klanten/assets/contracten in Excel/mail, geen realtime planning, geen inzicht in rendement per contract of klant.

## 3. Rolstructuur — belangrijk uitgangspunt

Twee niveaus. Ik interpreteer je omschrijving als volgt — **check dit voordat er gebouwd wordt**, want het bepaalt het datamodel:

**Platform-niveau**
- **Admin** (jij/je team): beheert tenants ("klanten" van de SaaS zelf), platformbrede dashboarding/reporting, facturatie richting tenants (Stripe).

**Tenant-niveau** (elk bedrijf dat het platform gebruikt = 1 tenant = jouw "Client")
- **Owner/Client** — volledige toegang tot alle modules binnen de tenant
- **Planner** — planning/roostering
- **Engineer** — eigen werkorders, mobiele weergave
- **Finance** — facturatie, contractwaarde, rapportages
- **Administratie** — facturatie-ondersteuning, administratieve taken

Binnen een tenant beheert die tenant vervolgens weer **zijn eigen klanten** — dat is de "Clients"-module (CRM). Dus: Admin beheert tenants, een tenant beheert zijn klanten. Zie `ARCHITECTURE.md` voor het datamodel.

## 4. Modules (kernfunctionaliteit)

Vergeleken met premium FSM-platforms (ServiceTitan, Jobber, Housecall Pro, Salesforce Field Service — zie research in het uitvoeringsplan van 2026-08-23) was deze lijst te dun: een "job" bestond nergens als eerste-klas object, er was geen klant-eigen portaal, geen voorraad/onderdelenbeheer, geen offertetraject, geen preventief onderhoud. Onderstaande lijst is bewust breder — dit is de visie, niet alles wordt tegelijk gebouwd (zie `ROADMAP.md` voor fasering en het per-fase "één issue per functie-slice"-principe).

**Klanten & assets**
- **Clients** — CRM voor de klanten van de tenant, incl. **Contactpersonen** (meerdere per klant, met rol) en **Locaties** (meerdere per klant, met adres + kaartcoördinaten)
- **Assets** — apparatuur/installaties per klant/locatie, type + subtype (afhankelijke referentielijsten), onderhoudshistorie, documenten/bijlagen (handleidingen, foto's, certificaten)

**Operations**
- **Work Orders** — de centrale werkeenheid: status-levenscyclus (nieuw → gepland → onderweg → bezig → afgerond → gefactureerd), gekoppeld aan klant/locatie/asset/engineer/contract, notities/foto's/handtekening
- **Planning/Dispatch** — planbord (lijst/kanban/kalender/kaart), toewijzing engineers aan Work Orders, drag-and-drop
- **Preventief onderhoud / Service Plans** — terugkerende onderhoudsschema's per asset/contract die automatisch Work Orders genereren vóór de vervaldatum
- **Checklists / inspectieformulieren** — configureerbare formuliertemplates per Work Order-type, in te vullen door engineers (foto's, digitale sign-off)
- **Urenregistratie** — in-/uitklokken per Work Order + reistijd, voedt contractrendement-rapportage

**Sales & Finance**
- **Offertes/Estimates** — offertetraject met sjablonen/prijsregels, omzetten naar Work Order/contract bij akkoord
- **Contracts** — SLA's, looptijd, entitlements/garantietermijnen, verlenging, gekoppelde assets, facturatietermijnen
- **Facturatie** — gegenereerd vanuit afgeronde Work Orders/contracten, betaalstatus, export (nu alleen genoemd als taak van Finance/Administratie — dit wordt een eigen module)
- **Reporting** — servicerapporten, PDF-export, contractrendement, first-time-fix rate, technicus-utilisatie
- **Dashboarding** — configureerbare widgets per rol, gevoed door echte Work Order-data zodra die bestaat

**Klantbeleving**
- **Klantportaal** — de eindklant van de tenant kan zelf Work Order-status/historie bekijken, offertes goedkeuren, facturen betalen
- **Notificaties/communicatie** — automatische sms/e-mail (ETA monteur, job afgerond, factuur vervalt), interne @mentions op een Work Order

**Platform**
- **Integraties** — koppelingen boekhouding/agenda/kaarten (via de Vercel Marketplace-aanpak die elders in deze stack al gebruikt wordt)
- **Multi-locatie/franchise** — voor de tenant zelf die met meerdere vestigingen/depots werkt, met roll-up rapportage
- **Kennisbank** en **IoT/remote monitoring** — langetermijnvisie, expliciet nog niet ingepland (zie `ROADMAP.md` Fase 5)

## 5. Verdienmodel
- Basis platformfee per tenant (per actieve gebruiker of flat fee)
- Modules als betaalde add-on via Stripe: bv. Core (Clients + Assets + Planning) inbegrepen, Contracts / Reporting / Dashboarding-pro als add-on
- Feature flags per tenant regelen dit — Admin kan modules aan/uit zetten, gesynchroniseerd met het Stripe-abonnement van die tenant

## 6. Premium ervaring — niet-onderhandelbaar
- Snappy: optimistic UI, server components waar mogelijk, geen volle page-reloads
- Inklapbare navigatie, hover states, command palette
- Meerdere weergaven per module (lijst / kanban / kalender / kaart)
- Configuratiescherm: functies per tenant aan/uit, zichtbaarheid per rol
- Eigen design system in-repo (`packages/ui`) — voor consistentie én bouwsnelheid
- **Relaties altijd zichtbaar in context**: een record met kind-entiteiten (klant → contactpersonen/locaties/assets, straks Work Order → checklist/onderdelen/uren) krijgt tabs, breadcrumbs en in-context aanmaken — nooit alleen een platte lijst + los modal-formulier
- **Referentiedata altijd configureerbaar per tenant**, en waar relevant **afhankelijk van elkaar** (bv. Asset Subtype hangt af van Asset Type) — nooit een hardcoded enum
- **Vettere, data-dichte pagina's naarmate er meer te tonen is**: het dashboard is nu bewust nog een lege Fase-0 placeholder — zodra Work Orders bestaan wordt dat een echt, dicht dashboard, geen losse kaartjes; het klantportaal en de mobiele engineer-weergave krijgen dezelfde designsysteem-kwaliteit als de tenant-app, niet een uitgeklede variant

## 7. Fasering
Zie `ROADMAP.md` — 5 fases, van fundament (auth/rollen/shell) tot premium polish. Bewust gekozen om het fundament eerst goed te zetten: elke module hangt af van tenancy + RBAC + de app-shell.

## 8. Techniek (kort)
Next.js op Vercel, Supabase (Postgres + Auth + Storage + Row Level Security), Stripe, apart design-system package. Details in `ARCHITECTURE.md`.

## 9. Risico's & aandachtspunten
- **Data-isolatie tussen tenants** — Row Level Security is verplicht op elke tabel, geen enkele query zonder org-scope.
- **Scope-creep** — hou fase 0–1 klein en werkend voordat je doorbouwt.
- **Rolcomplexiteit** — test permissies per rol expliciet (zie `qa-reviewer` agent).
