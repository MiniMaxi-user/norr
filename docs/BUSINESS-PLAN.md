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
- **Clients** — CRM voor de klanten van de tenant (contactpersonen, locaties)
- **Assets** — apparatuur/installaties per klant/locatie, onderhoudshistorie
- **Contracts** — SLA's, looptijd, gekoppelde assets, facturatietermijnen
- **Planning** — planbord (lijst/kanban/kalender/kaart), toewijzing engineers
- **Reporting** — servicerapporten, PDF-export, contractrendement
- **Dashboarding** — configureerbare widgets per rol

## 5. Verdienmodel
- Basis platformfee per tenant (per actieve gebruiker of flat fee)
- Modules als betaalde add-on via Stripe: bv. Core (Clients + Assets + Planning) inbegrepen, Contracts / Reporting / Dashboarding-pro als add-on
- Feature flags per tenant regelen dit — Admin kan modules aan/uit zetten, gesynchroniseerd met het Stripe-abonnement van die tenant

## 6. Premium ervaring — niet-onderhandelbaar
- Snappy: optimistic UI, server components waar mogelijk, geen volle page-reloads
- Inklapbare navigatie, hover states, command palette
- Meerdere weergaven per module (lijst / kanban / kalender / kaart)
- Configuratiescherm: functies per tenant aan/uit, zichtbaarheid per rol
- Eigen design system in een aparte repo — voor consistentie én bouwsnelheid

## 7. Fasering
Zie `ROADMAP.md` — 5 fases, van fundament (auth/rollen/shell) tot premium polish. Bewust gekozen om het fundament eerst goed te zetten: elke module hangt af van tenancy + RBAC + de app-shell.

## 8. Techniek (kort)
Next.js op Vercel, Supabase (Postgres + Auth + Storage + Row Level Security), Stripe, apart design-system package. Details in `ARCHITECTURE.md`.

## 9. Risico's & aandachtspunten
- **Data-isolatie tussen tenants** — Row Level Security is verplicht op elke tabel, geen enkele query zonder org-scope.
- **Scope-creep** — hou fase 0–1 klein en werkend voordat je doorbouwt.
- **Rolcomplexiteit** — test permissies per rol expliciet (zie `qa-reviewer` agent).
