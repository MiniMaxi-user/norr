"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, clampLimit, clampOffset, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { geocodeAddress } from "@/lib/geocoding/nominatim";
import {
  clientCreateSchema,
  clientUpdateSchema,
  siteBaseSchema,
  siteUpdateSchema,
  SITE_PURPOSE_REQUIRED_MESSAGE,
  siteContactRequiredMessage,
  hasContactRole,
  type SiteContactRole,
  type SiteContactRoleInput,
  type SiteCreateInput,
  type SiteUpdateInput,
} from "./schema";
import { rateOverrideSchema, toRateOverrideRow, type RateOverrideRow } from "@/lib/rate-overrides/schema";

/**
 * Server Actions for the Clients module (clients + their sites), issue #8
 * backend half. Every action:
 *  1. Resolves session + feature flag + RBAC actor via `requireModuleContext`
 *     (CLAUDE.md rules 2 & 3 — checked before any side effect).
 *  2. Checks `can()`/`canAny()` from `lib/rbac/permissions.ts` for the
 *     specific action (never an inline `if (role === ...)`).
 *  3. Validates input with the Zod schemas in `./schema.ts`.
 *  4. Runs the query under the caller's own session via
 *     `lib/supabase/server.ts` (never `admin.ts`) — RLS is always the
 *     backstop, `can()` is just there to fail cleanly *before* hitting the
 *     DB and to drive UI affordances.
 *
 * RBAC recap for `clients` (lib/rbac/permissions.ts, matches
 * docs/ARCHITECTURE.md matrix): `owner` has CRUD; `planner`/`finance`/
 * `administratie` have plain `read` (full org-wide read); `engineer` has
 * only `read_own` ("Read (assigned)" in the matrix). There is no
 * assignment relationship modeled on `clients` yet (that's a Phase 2
 * concept, once contracts/work_orders exist), so there is currently no data
 * to scope "own" by — `read_own` is treated the same as `read` here for
 * now (i.e. an Engineer sees every client in their org, same as what RLS
 * already allows any member to SELECT). Revisit this the moment a
 * client-assignment concept exists; don't assume this is a deliberate
 * long-term product decision, it's a stopgap forced by the schema.
 */

export interface ClientRecord {
  id: string;
  organization_id: string;
  name: string;
  /** Dutch Chamber of Commerce (KvK) registration number — see migration
   * `20260825150000_clients_business_fields.sql`. `email` was dropped from
   * this table in the same migration (issue #43): a client's contact email
   * now only ever lives on its `Contact` rows (`contacts-actions.ts`), never
   * on the client itself. */
  kvk_number: string | null;
  vat_number: string | null;
  iban: string | null;
  notes: string | null;
  /** When set, this Client row IS a real platform tenant — links to the
   * `organizations` row a Platform Admin manages through this same Client
   * record (issue #45). See migration
   * `20260825160000_clients_represents_organization.sql` and
   * `activateAsTenant` below. `null` for an ordinary CRM client. */
  represents_organization_id: string | null;
  /** Whether the linked tenant organization is currently active (issue #47),
   * i.e. `organizations.is_active` for the org `represents_organization_id`
   * points at — see migration `20260826120000_organizations_is_active.sql`.
   * `null` when this client has never been activated as a tenant
   * (`represents_organization_id` is `null`), in which case "active" isn't a
   * meaningful question. Populated by `getClient` below, and by
   * `listClients({ includePrimarySite: true })` for a Platform Admin only
   * (issue #220, List/Kanban tenant badge), via an
   * embedded join on `organizations` — `createClient`/
   * `updateClient`/`activateAsTenant` don't render the tenant-status UI and
   * would otherwise pay for a join whose result is never read, so they leave
   * this `undefined` on the objects they return (harmless: this field is
   * only ever read by UI that already has a `getClient` result). Toggled by
   * `setTenantActive` in `./platform-access-actions.ts`. */
  organization_is_active: boolean | null;
  /** The kanban's 4 fixed columns (issue #58): `lead` | `qualified` |
   * `proposal` | `won`. See `clientStatusSchema` in `./schema.ts` and
   * migration `20260827100000_clients_kanban_status.sql`. */
  status: string;
  /** FK into `public.account_managers` — the client's default Account
   * Manager, shown on its kanban card. `null` when unset. */
  account_manager_id: string | null;
  /** A potential deal amount (issue #58) — explicitly NOT "ARR". `null` when
   * unset. */
  potential_value: number | null;
  /** Nullable date. The app defaults this to today only on create; see
   * `clientSince` in `./schema.ts`. */
  client_since: string | null;
  /** Payment term in days for invoices to this client (issue #232). `null` =
   * the organization default (Settings → Invoicing). */
  payment_term_days: number | null;
  /** Attach the UBL e-invoice to this client's invoice e-mails (issue #241). Default false. */
  ubl_email_enabled: boolean;
  /** Read-only — maintained entirely by the DB's `set_client_won_at`
   * trigger, never written by `createClient`/`updateClient`. Timestamp of
   * when this client most recently became `status = 'won'`; drives the
   * kanban's "Won" column 4-week visibility window. `null` if never won (or
   * no longer currently won — see the trigger's "became Won" semantics in
   * the migration's doc comment). */
  won_at: string | null;
  /** Issue #93 rate override fields ("Afwijkend tarief" on the client page)
   * — identical shape to `public.memberships`' own 5 columns, see
   * `lib/rate-overrides/schema.ts`'s header comment and
   * `updateClientRateSettings` below. `select("*")` already returns these on
   * every query in this file (`listClients`/`getClient`/`createClient`/
   * `updateClient`); they're declared here so callers get typed access
   * rather than needing a cast. */
  has_custom_rate: boolean;
  travel_article_id: string | null;
  work_article_id: string | null;
  travel_sale_price: number | null;
  work_sale_price: number | null;
  /** Issue #120 — a per-client logo. See migration
   * `20260903090000_clients_logo_and_organization_own_client.sql` and
   * `lib/clients/logo-url.ts`'s `getClientLogoUrl` (path + timestamp ->
   * cache-busted public URL). `select("*")` already returns both columns on
   * every query in this file; declared here so callers get typed access
   * rather than needing a cast, same reasoning as the rate-override fields
   * above. Written only by `../logo-actions.ts`, never by `updateClient`. */
  logo_path: string | null;
  logo_updated_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteRecord {
  id: string;
  organization_id: string;
  client_id: string;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  is_visit_address: boolean;
  is_invoice_address: boolean;
  is_delivery_address: boolean;
  /** The site contact matrix (issue #273): one entry per (contact, role).
   * Only populated by `getClient`, `createSite` and `updateSite` — the
   * other projections in this file don't load it (reads back `undefined`
   * there, same loose-typing tradeoff as `region_id` below). */
  contact_roles: { contact_id: string; role: SiteContactRole }[];
  is_primary: boolean;
  /** This site's own contact number — phone lives on the site, not the
   * client (a client can have multiple sites, each with its own number). See
   * migration `20260826130000_sites_phone.sql`. */
  phone: string | null;
  notes: string | null;
  /** Nullable FK into this org's `region` reference list (issue #164,
   * Planning module) — see migration `20260915090000_region_reference_list.sql`.
   * Only populated by queries that actually project it (today:
   * `listSitesForClientIds`, for the Planning backlog/scheduler board's
   * region grouping) — every other function in this file keeps its existing
   * explicit column projection unchanged, so this reads back `undefined` at
   * runtime there despite the non-optional type, same loose-typing tradeoff
   * this file's explicit-projection convention already accepts elsewhere. */
  region_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientDependencyCounts {
  sites: number;
  assets: number;
}

const uuidSchema = z.string().uuid("Invalid id.");

function toClientInsertRow(input: ReturnType<typeof clientCreateSchema.parse>, organizationId: string) {
  return {
    organization_id: organizationId,
    name: input.name,
    kvk_number: input.kvkNumber ?? null,
    vat_number: input.vatNumber ?? null,
    iban: input.iban ?? null,
    notes: input.notes ?? null,
    // `status` omitted (left out of the row entirely, not written as
    // `null`) when the caller didn't submit one — the DB's own
    // `not null default 'lead'` covers that case, same "let the DB default
    // apply" treatment `typeId`/`statusId` get elsewhere in this codebase
    // (e.g. `assets`/`contracts`' own derive-default triggers) rather than
    // this app layer re-deriving 'lead' itself.
    ...(input.status !== undefined ? { status: input.status } : {}),
    account_manager_id: input.accountManagerId ?? null,
    potential_value: input.potentialValue ?? null,
    client_since: input.clientSince ?? null,
    payment_term_days: input.paymentTermDays ?? null,
    ...(input.ublEmailEnabled !== undefined ? { ubl_email_enabled: input.ublEmailEnabled } : {}),
    // `won_at` is never written here — trigger-only, excluded from this
    // table's INSERT column grants entirely (see
    // `20260827100000_clients_kanban_status.sql`).
  };
}

function toClientUpdateRow(input: ReturnType<typeof clientUpdateSchema.parse>, rawInput: Record<string, unknown>) {
  const row: Record<string, unknown> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.kvkNumber !== undefined) row.kvk_number = input.kvkNumber ?? null;
  if (input.vatNumber !== undefined) row.vat_number = input.vatNumber ?? null;
  if (input.iban !== undefined) row.iban = input.iban ?? null;
  if (input.notes !== undefined) row.notes = input.notes ?? null;
  if (input.status !== undefined) row.status = input.status;
  // `accountManagerId` needs special handling unlike every other optional
  // field above: `optionalAccountManagerId()`'s empty-string-to-undefined
  // preprocessing (needed so the edit panel's <select> "No account manager"
  // option doesn't fail uuid validation) makes "field not submitted at all"
  // and "submitted as the clear option" collapse to the same `undefined` in
  // `input` (parsed) — indistinguishable from that point on. The edit panel
  // always submits this field as part of a full form render (never a
  // genuinely partial caller), so an empty string in `rawInput` (pre-zod)
  // unambiguously means "the user picked 'No account manager'", not "field
  // omitted" — checked against `rawInput` specifically to recover that
  // distinction zod's own preprocessing already erased.
  if (input.accountManagerId !== undefined) {
    row.account_manager_id = input.accountManagerId;
  } else if (rawInput.accountManagerId === "") {
    row.account_manager_id = null;
  }
  // Same clear-vs-omitted ambiguity as `accountManagerId` above, and the
  // same fix: `optionalPotentialValueSchema`/`optionalIsoDateSchema` also
  // preprocess an empty string to `undefined` (a cleared number/date input
  // submits `""` in `FormData`, same as a cleared `<select>`), so an
  // explicit clear on the edit form would otherwise silently no-op instead
  // of nulling out an already-set value.
  if (input.potentialValue !== undefined) {
    row.potential_value = input.potentialValue;
  } else if (rawInput.potentialValue === "") {
    row.potential_value = null;
  }
  if (input.clientSince !== undefined) {
    row.client_since = input.clientSince;
  } else if (rawInput.clientSince === "") {
    row.client_since = null;
  }
  if (input.paymentTermDays !== undefined) {
    row.payment_term_days = input.paymentTermDays;
  } else if (rawInput.paymentTermDays === "") {
    row.payment_term_days = null;
  }
  if (input.ublEmailEnabled !== undefined) row.ubl_email_enabled = input.ublEmailEnabled;
  // `won_at` is never written here — see `toClientInsertRow`'s comment above.
  return row;
}

/** Purpose/primary flags are passed in separately (`purpose`) rather than
 * read straight off `input`: `createSite` computes their final values itself
 * (either the caller's submitted values, or the "first site for this
 * client" server-side override — see `createSite`), never trusting
 * `input`'s raw booleans directly for the write. `geocoded` is the result
 * (or `null`) of `geocodeAddress`, written alongside `latitude`/`longitude`. */
function toSiteInsertRow(
  input: SiteCreateInput,
  purpose: { isVisitAddress: boolean; isInvoiceAddress: boolean; isDeliveryAddress: boolean; isPrimary: boolean },
  geocoded: { latitude: number; longitude: number } | null,
) {
  return {
    client_id: input.clientId,
    address_line1: input.addressLine1,
    address_line2: input.addressLine2 ?? null,
    postal_code: input.postalCode,
    city: input.city,
    country: input.country,
    notes: input.notes ?? null,
    is_visit_address: purpose.isVisitAddress,
    is_invoice_address: purpose.isInvoiceAddress,
    is_delivery_address: purpose.isDeliveryAddress,
    is_primary: purpose.isPrimary,
    phone: input.phone ?? null,
    latitude: geocoded?.latitude ?? null,
    longitude: geocoded?.longitude ?? null,
    geocoded_at: geocoded ? new Date().toISOString() : null,
  };
}

/** `geocoded` is only ever a real `{ latitude, longitude }` result here, never
 * `null`/`undefined`: per spec, a geocoding miss (no match/failure) on an
 * update must leave `latitude`/`longitude`/`geocoded_at` **unchanged**
 * (unlike `toSiteInsertRow`, where a miss writes explicit `null`s onto a
 * brand-new row that has no prior value to preserve) — so `updateSite` only
 * calls this with a `geocoded` argument at all when `geocodeAddress`
 * actually returned a match; a miss (or no address field touched) simply
 * omits the argument and the columns are left out of `row` entirely. */
function toSiteUpdateRow(input: SiteUpdateInput, geocoded?: { latitude: number; longitude: number }) {
  const row: Record<string, unknown> = {};
  if (input.clientId !== undefined) row.client_id = input.clientId;
  if (input.addressLine1 !== undefined) row.address_line1 = input.addressLine1;
  if (input.addressLine2 !== undefined) row.address_line2 = input.addressLine2 ?? null;
  if (input.postalCode !== undefined) row.postal_code = input.postalCode;
  if (input.city !== undefined) row.city = input.city;
  if (input.country !== undefined) row.country = input.country;
  if (input.notes !== undefined) row.notes = input.notes ?? null;
  if (input.isVisitAddress !== undefined) row.is_visit_address = input.isVisitAddress;
  if (input.isInvoiceAddress !== undefined) row.is_invoice_address = input.isInvoiceAddress;
  if (input.isDeliveryAddress !== undefined) row.is_delivery_address = input.isDeliveryAddress;
  if (input.isPrimary !== undefined) row.is_primary = input.isPrimary;
  if (input.phone !== undefined) row.phone = input.phone ?? null;
  if (geocoded) {
    row.latitude = geocoded.latitude;
    row.longitude = geocoded.longitude;
    row.geocoded_at = new Date().toISOString();
  }
  return row;
}

/** Maps a DB error from a `sites` write to a clean, user-safe message.
 * Adds the `23505` (unique_violation) case on top of the shared `mapDbError`
 * — same reasoning and shape as `contacts-actions.ts`'s `mapContactDbError`:
 * at most one `is_primary = true` per client is enforced by the DB
 * (`enforce_single_primary_site`, backstopped by the partial unique index
 * `sites_one_primary_per_client_idx`), and a genuine race between two
 * concurrent "set as primary" calls for the same client can surface as a
 * `23505` here too, which `mapDbError` itself has no case for. */
function mapSiteDbError(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "Another site was just set as the primary address for this client. Please try again.";
  }
  return mapDbError(error);
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export interface ListClientsOptions {
  limit?: number;
  offset?: number;
  /**
   * Issue #148: when true, folds each returned client's primary site into
   * this same query (a single PostgREST embed over the genuine
   * `sites.client_id` FK, filtered to `is_primary = true`) instead of the
   * board doing a separate bulk `listPrimarySitesForClients` round-trip
   * after this one resolves. Left `false` (default) for every other caller
   * of `listClients` (the assets/work-orders/activities/contracts/quotes
   * "pick a client" pickers/relation-cards) so they don't pay for a join
   * they never read — see the column-projection comment below for why this
   * function is shared and stays lean by default.
   */
  includePrimarySite?: boolean;
  /**
   * List-page filters (web design system list shell). Only honoured together
   * with `includePrimarySite` — the Clients list is the one caller. Every
   * other caller passes none and is unaffected.
   *
   * `search` matches the client's name or KvK number, or the phone/city of
   * its primary site (same fields the old client-side search covered).
   */
  search?: string;
  /** Exact `clients.status` (`lead` | `qualified` | `proposal` | `won`). */
  status?: string;
  /** Exact `clients.account_manager_id`. */
  accountManagerId?: string;
  /** `set` = potential value filled in, `unset` = not. */
  potential?: "set" | "unset";
  /** Sort column; unknown values fall back to `name`. */
  sort?: "name" | "status" | "potential_value" | "created_at";
  direction?: "asc" | "desc";
}

const CLIENT_SORT_COLUMNS = new Set(["name", "status", "potential_value", "created_at"]);

/** Strips characters that would break a PostgREST `or()`/`ilike` pattern. */
function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[,()%*\\"':]/g, " ").replace(/[\s]+/g, " ").trim().slice(0, 80);
}

/** Row shape only used internally when `includePrimarySite` is set — the
 * embedded `sites` relation is a has-many from `clients`' side, but the
 * `is_primary = true` filter plus `sites_one_primary_per_client_idx` (at
 * most one primary per client) means it never carries more than one
 * element. Peeled off into `primarySiteByClientId` before the rows are cast
 * to plain `ClientRecord`s below — `ClientRecord` itself never carries a
 * `sites` field. */
type ClientRowWithPrimarySite = ClientRecord & {
  sites: SiteRecord[];
  /** Only present for a Platform Admin (issue #220) — see `listClients`. */
  organizations?: { is_active: boolean } | null;
};

export async function listClients(
  options: ListClientsOptions = {},
): Promise<
  ActionResult<{
    clients: ClientRecord[];
    count: number;
    /** Only set when a list filter was applied: the unfiltered total, for
     * the "3 of 12" count. */
    unfilteredCount?: number;
    primarySiteByClientId?: Record<string, SiteRecord | null>;
  }>
> {
  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "clients", ["read", "read_own"])) {
    return fail("You do not have permission to view clients.");
  }

  const limit = clampLimit(options.limit, 50, 200);
  const offset = clampOffset(options.offset);

  const supabase = await createSupabaseServerClient();
  // Explicit column projection (issue #149) — this feeds the Clients List
  // table AND Kanban board (`clients-board.tsx`) directly, PLUS every other
  // module's "pick a client" dropdown/relation-card fallback that reuses this
  // same call (assets/work-orders/activities/contracts/quotes — see those
  // modules' own relation-cards/relation-fields components). The set below is
  // the exhaustive union of every field any of those consumers actually
  // reads: List/Kanban read `name`/`status`/`potential_value`/
  // `account_manager_id`/`logo_path`/`logo_updated_at`/`won_at`/`created_at`;
  // the relation-cards' hover-expand panel (KvK/VAT/IBAN/Notes) also reads
  // `kvk_number`/`vat_number`/`iban`/`notes` off a candidate straight from
  // this same array (see `lib/relation-cards/resolve-relation.ts`'s "same
  // select(\"*\")-shaped queries" doc comment — candidates and the
  // `getClient` fallback must stay field-compatible for those cards).
  // Deliberately excludes `organization_id` (RLS already scopes this query;
  // nothing downstream reads it back), `represents_organization_id`/
  // `client_since`/the rate-override columns/`created_by`/`updated_at`
  // (detail-page-only, via `getClient`/`updateClientRateSettings`).
  if (!options.includePrimarySite) {
    const { data, error, count } = await supabase
      .from("clients")
      .select(
        "id, name, kvk_number, vat_number, iban, notes, status, account_manager_id, potential_value, won_at, logo_path, logo_updated_at, created_at",
        { count: "exact" },
      )
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) return fail(mapDbError(error));
    return ok({ clients: (data ?? []) as ClientRecord[], count: count ?? 0 });
  }

  // Embedding on `sites` (the genuine `sites.client_id -> clients.id` FK, no
  // migration needed) with a filter on the embedded resource, NOT
  // `sites!inner(...)`: PostgREST's default (left) embed filters only
  // restrict which child rows appear in the nested array, they never drop a
  // parent `clients` row that has no matching site — see PostgREST's
  // "Filtering through embedded resources" docs. That matters here: a client
  // with zero sites (or none marked primary yet) must still come back with
  // an empty `sites: []`, not be excluded from the page/count.
  //
  // Issue #220: for a Platform Admin only, also embed the linked tenant's
  // `is_active` (same disambiguated `organizations!represents_organization_id`
  // embed `getClient` uses) so the List/Kanban can badge which clients are
  // tenants. Every other actor skips the join and gets
  // `organization_is_active: undefined` -> no badge rendered.
  const tenantEmbed = ctx.context.actor.isPlatformAdmin
    ? ", represents_organization_id, organizations!represents_organization_id(is_active)"
    : "";
  let query = supabase
    .from("clients")
    .select(
      `id, name, kvk_number, vat_number, iban, notes, status, account_manager_id, potential_value, won_at, logo_path, logo_updated_at, created_at, sites(id, client_id, city, country, phone)${tenantEmbed}`,
      { count: "exact" },
    )
    .eq("sites.is_primary", true);

  const term = sanitizeSearchTerm(options.search ?? "");
  const filtered = Boolean(term || options.status || options.accountManagerId || options.potential);
  if (term) {
    // Phone/city live on the primary site, so resolve those matches first and
    // fold their client ids into the same `or()`.
    const { data: siteMatches } = await supabase
      .from("sites")
      .select("client_id")
      .eq("is_primary", true)
      .or(`city.ilike.%${term}%,phone.ilike.%${term}%`)
      .limit(200);
    const ids = (siteMatches ?? []).map((row) => row.client_id as string);
    query = query.or(
      [`name.ilike.%${term}%`, `kvk_number.ilike.%${term}%`, ...(ids.length > 0 ? [`id.in.(${ids.join(",")})`] : [])].join(","),
    );
  }
  if (options.status) query = query.eq("status", options.status);
  if (options.accountManagerId) query = query.eq("account_manager_id", options.accountManagerId);
  if (options.potential === "set") query = query.not("potential_value", "is", null);
  if (options.potential === "unset") query = query.is("potential_value", null);

  const sortColumn = options.sort && CLIENT_SORT_COLUMNS.has(options.sort) ? options.sort : "name";
  const ascending = options.direction !== "desc";
  query = query.order(sortColumn, { ascending, nullsFirst: false });
  if (sortColumn !== "name") query = query.order("name", { ascending: true });

  const [{ data, error, count }, unfiltered] = await Promise.all([
    query.range(offset, offset + limit - 1),
    filtered ? supabase.from("clients").select("id", { count: "exact", head: true }) : Promise.resolve(null),
  ]);

  if (error) return fail(mapDbError(error));

  const primarySiteByClientId: Record<string, SiteRecord | null> = {};
  const clients: ClientRecord[] = [];
  for (const row of (data ?? []) as unknown as ClientRowWithPrimarySite[]) {
    const { sites, organizations: linkedOrganization, ...clientRow } = row;
    clients.push(
      linkedOrganization === undefined
        ? clientRow
        : { ...clientRow, organization_is_active: linkedOrganization?.is_active ?? null },
    );
    primarySiteByClientId[clientRow.id] = sites?.[0] ?? null;
  }
  return ok({
    clients,
    count: count ?? 0,
    ...(unfiltered ? { unfilteredCount: unfiltered.count ?? 0 } : {}),
    primarySiteByClientId,
  });
}

export async function getClient(
  id: string,
): Promise<ActionResult<{ client: ClientRecord; sites: SiteRecord[] }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "clients", ["read", "read_own"])) {
    return fail("You do not have permission to view this client.");
  }

  const supabase = await createSupabaseServerClient();
  const [clientResult, sitesResult] = await Promise.all([
    // `organizations!represents_organization_id(is_active)`: `clients` has
    // TWO foreign keys into `organizations` (`organization_id`, the client's
    // own tenant, and `represents_organization_id`, the tenant it activates
    // — see migration `20260825160000_clients_represents_organization.sql`),
    // so the embed must name the FK column after `!` to disambiguate which
    // relationship PostgREST should follow; without it this select would
    // fail with an "more than one relationship was found" error. This is a
    // many-to-one embed from `clients`' side of a *unique* FK
    // (`clients_represents_organization_id_idx`), so PostgREST returns a
    // single object (or `null` when `represents_organization_id` is `null`),
    // never an array — see the destructuring below.
    supabase
      .from("clients")
      .select("*, organizations!represents_organization_id(is_active)")
      .eq("id", idResult.data)
      .maybeSingle(),
    // `sites.name` no longer exists (issue #42) — ordered by address line 1
    // instead, the closest equivalent to an alphabetical "name" ordering now
    // that a site is identified purely by its address.
    supabase
      .from("sites")
      .select("*, site_contact_roles(contact_id, role)")
      .eq("client_id", idResult.data)
      .order("address_line1", { ascending: true }),
  ]);

  if (clientResult.error) return fail(mapDbError(clientResult.error));
  if (!clientResult.data) return fail("Client not found.");
  if (sitesResult.error) return fail(mapDbError(sitesResult.error));

  // Peel the embedded `organizations` object off the row before casting the
  // rest to `ClientRecord` (which models `organization_is_active` as a flat
  // boolean, not a nested join result) — `null` when never activated as a
  // tenant, matching `organization_is_active`'s own doc comment above.
  const { organizations: linkedOrganization, ...clientRow } = clientResult.data as ClientRecord & {
    organizations: { is_active: boolean } | null;
  };

  return ok({
    client: { ...clientRow, organization_is_active: linkedOrganization?.is_active ?? null } as ClientRecord,
    sites: ((sitesResult.data ?? []) as unknown as (Omit<SiteRecord, "contact_roles"> & {
      site_contact_roles: SiteRecord["contact_roles"] | null;
    })[]).map(({ site_contact_roles: roles, ...site }) => ({
      ...site,
      contact_roles: (roles ?? []).map((r) => ({ contact_id: r.contact_id, role: r.role })),
    })) as SiteRecord[],
  });
}

export async function createClient(input: unknown): Promise<ActionResult<{ client: ClientRecord }>> {
  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "create")) {
    return fail("Only the organization owner can create clients.");
  }

  const parsed = clientCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .insert(toClientInsertRow(parsed.data, ctx.context.organizationId))
    .select("*")
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ client: data as ClientRecord });
}

export async function updateClient(
  id: string,
  input: unknown,
): Promise<ActionResult<{ client: ClientRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "update")) {
    return fail("Only the organization owner can update clients.");
  }

  const parsed = clientUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toClientUpdateRow(parsed.data, input && typeof input === "object" ? (input as Record<string, unknown>) : {});
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .update(row)
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Client not found, or you do not have permission to update it.");
  return ok({ client: data as ClientRecord });
}

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Defense-in-depth existence check for `travelArticleId`/`workArticleId`,
 * same pattern as `validateAssetModel` in `app/(app)/assets/actions.ts` and
 * `validateRateOverrideArticle` in `lib/team/actions.ts` (this file's own
 * copy, not imported from there — that file is a different module and this
 * check is small enough to duplicate rather than add a cross-module
 * dependency for): RLS on `articles` (any org member may SELECT) already
 * scopes this lookup to the caller's own organization, so a hit here also
 * proves org membership — no separate `.eq("organization_id", ...)` filter
 * needed. Backstopped either way by the DB's own
 * `validate_rate_override_articles` trigger. */
async function validateClientRateOverrideArticle(
  supabase: SupabaseServerClient,
  articleId: string,
  label: "travel" | "work",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.from("articles").select("id").eq("id", articleId).maybeSingle();
  if (error) return { ok: false, error: mapDbError(error) };
  if (!data) {
    return {
      ok: false,
      error: `Invalid ${label} article — it does not exist, or it does not belong to your organization.`,
    };
  }
  return { ok: true };
}

/**
 * Owner-only. Sets/clears a client's custom Travel-time/Work-time billing
 * rate override (issue #93, "Afwijkend tarief" on the client page) — same
 * shape and validation as `updateTeamMemberRateSettings` in
 * `lib/team/actions.ts` (see `lib/rate-overrides/schema.ts`'s header
 * comment), applied to `public.clients` instead of `public.memberships`.
 * Per the story's later resolution order (engineer default -> CLIENT
 * override -> contract override, out of scope here), this is a plain,
 * unscoped per-client setting — no engineer/contract relationship to check
 * here.
 *
 * `hasCustomRate: false` clears `travelArticleId`/`workArticleId`/
 * `travelSalePrice`/`workSalePrice` back to `null` — see
 * `toRateOverrideRow`'s comment for why.
 */
export async function updateClientRateSettings(
  id: string,
  input: unknown,
): Promise<ActionResult<{ client: ClientRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "update")) {
    return fail("Only the organization owner can update a client's rate settings.");
  }

  const parsed = rateOverrideSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();

  if (parsed.data.hasCustomRate) {
    const [travelCheck, workCheck] = await Promise.all([
      validateClientRateOverrideArticle(supabase, parsed.data.travelArticleId as string, "travel"),
      validateClientRateOverrideArticle(supabase, parsed.data.workArticleId as string, "work"),
    ]);
    if (!travelCheck.ok) return fail("Please fix the highlighted fields.", { travelArticleId: [travelCheck.error] });
    if (!workCheck.ok) return fail("Please fix the highlighted fields.", { workArticleId: [workCheck.error] });
  }

  const row: RateOverrideRow = toRateOverrideRow(parsed.data);
  const { data, error } = await supabase
    .from("clients")
    .update(row)
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Client not found, or you do not have permission to update it.");
  return ok({ client: data as ClientRecord });
}

/**
 * Dependency counts for the delete-confirmation UI. `sites.client_id` and
 * `assets.client_id` both have `on delete cascade` at the DB level (see
 * `supabase/migrations/20260822190000_clients_sites_assets.sql`), so
 * deleting a client silently deletes every one of its sites and assets too
 * — the caller should show this count before letting the user confirm.
 */
export async function getClientDependencyCounts(id: string): Promise<ActionResult<ClientDependencyCounts>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "clients", ["read", "read_own"])) {
    return fail("You do not have permission to view this client.");
  }

  const supabase = await createSupabaseServerClient();
  const [sitesResult, assetsResult] = await Promise.all([
    supabase.from("sites").select("id", { count: "exact", head: true }).eq("client_id", idResult.data),
    supabase.from("assets").select("id", { count: "exact", head: true }).eq("client_id", idResult.data),
  ]);

  if (sitesResult.error) return fail(mapDbError(sitesResult.error));
  if (assetsResult.error) return fail(mapDbError(assetsResult.error));

  return ok({ sites: sitesResult.count ?? 0, assets: assetsResult.count ?? 0 });
}

/**
 * Hard delete. Cascades to `sites` and `assets` at the DB level (see
 * `getClientDependencyCounts` above) — call that first and have the UI
 * confirm before calling this.
 */
export async function deleteClient(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "delete")) {
    return fail("Only the organization owner can delete clients.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Client not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}

/**
 * Platform-admin-only (issue #45): turns an existing Client row into a real
 * platform tenant by creating an `organizations` row and linking it via
 * `clients.represents_organization_id`. This is how a Platform Admin
 * "activates" a tenant they've been managing as a plain Client record
 * (Sites/Contacts/Assets/Contracts/Work Orders/Quotes on that client keep
 * working unchanged either way — this action only ever adds the link).
 *
 * Deliberately NOT gated by `can(actor, "clients", ...)` — Platform Admin is
 * not a `TenantRole` (see `lib/rbac/permissions.ts`'s `PermissionActor`
 * comment) and this action has nothing to do with the ordinary
 * clients-module RBAC matrix; it's checked directly against
 * `ctx.context.session.isPlatformAdmin` (`users.is_platform_admin`, see
 * `lib/auth/session.ts`) so a regular tenant owner — who otherwise passes
 * every `can(actor, "clients", "update")` check on their own clients — can
 * never call this successfully.
 *
 * Still goes through `requireModuleContext("clients")` first: a Platform
 * Admin must also be a member of some organization (their own dedicated
 * "Platform" org, bootstrapped by hand — see the migration's header
 * comment) with the `clients` feature enabled, same as any other caller of
 * this module's actions — this action operates on a Client row that lives
 * inside THAT organization, not the tenant being activated.
 */
export async function activateAsTenant(clientId: string): Promise<ActionResult<{ client: ClientRecord }>> {
  const idResult = uuidSchema.safeParse(clientId);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!ctx.context.session.isPlatformAdmin) {
    return fail("Only a platform admin can activate a client as a tenant.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: existing, error: existingError } = await supabase
    .from("clients")
    .select("id, name, represents_organization_id")
    .eq("id", idResult.data)
    .maybeSingle();
  if (existingError) return fail(mapDbError(existingError));
  if (!existing) return fail("Client not found.");
  if (existing.represents_organization_id) {
    return fail("This client is already activated as a tenant.");
  }

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .insert({ name: existing.name, created_by: ctx.context.session.userId })
    .select("id")
    .single();
  if (organizationError) return fail(mapDbError(organizationError));

  const { data, error } = await supabase
    .from("clients")
    .update({ represents_organization_id: organization.id })
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Client not found, or you do not have permission to update it.");
  return ok({ client: data as ClientRecord });
}

// ---------------------------------------------------------------------------
// Sites (a client's physical locations — a client needs at least one for
// assets to attach to). Gated on the `clients` module/RBAC entry, same as
// the client record itself: sites aren't a separate row in the RBAC matrix,
// they're a sub-resource of Clients.
// ---------------------------------------------------------------------------

export async function listSites(clientId: string): Promise<ActionResult<{ sites: SiteRecord[] }>> {
  const idResult = uuidSchema.safeParse(clientId);
  if (!idResult.success) return fail("Invalid client id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "clients", ["read", "read_own"])) {
    return fail("You do not have permission to view sites.");
  }

  const supabase = await createSupabaseServerClient();
  // Explicit column projection (issue #149) — shared across every
  // client-scoped "sites" picker/relation-card consumer (quote/work-order/
  // activity forms' Site `<select>`, `WorkOrderRelationCards`'/
  // `AssetRelationCards`'/`activity-hero.tsx`'s hover-expand facts, which read
  // `phone`/`is_visit_address`/`is_invoice_address`/`is_delivery_address`/
  // `is_primary` plus the full address via `formatSiteAddress`). Excludes
  // `client_id` (already scoped by the `clientId` argument, never read back),
  // `notes`/
  // `geocoded_at`/`created_by`/`created_at`/`updated_at` (none of this
  // function's consumers read those).
  const { data, error } = await supabase
    .from("sites")
    .select(
      "id, address_line1, address_line2, postal_code, city, country, phone, is_visit_address, is_invoice_address, is_delivery_address, is_primary",
    )
    .eq("client_id", idResult.data)
    // See `getClient`'s equivalent query above for why `address_line1`, not
    // `name` (dropped, issue #42).
    .order("address_line1", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ sites: (data ?? []) as SiteRecord[] });
}

/**
 * Bulk counterpart to `listSites`, for standard overviews (List/Kanban) that
 * need every visible client's primary site's address in one shot instead of
 * one `listSites` call per client (issue #75 — the Kanban view was doing up
 * to 200 separate round-trips for `listClients({ limit: 200 })`'s worth of
 * clients). `is_primary` is at most one `true` per `client_id`
 * (`sites_one_primary_per_client_idx`), so filtering on it directly returns
 * at most one row per requested client — no further grouping/dedup needed
 * beyond keying the result by `client_id`. Same RLS/permission boundary as
 * `listSites` (select: any org member).
 *
 * As of issue #148, `clients-board.tsx` no longer calls this: it folds the
 * same primary-site lookup into `listClients({ includePrimarySite: true })`
 * directly (one query instead of two sequential round-trips). Left in place
 * as a standalone bulk helper for any other caller that has a client-id set
 * without already going through `listClients` — e.g. a future view that
 * needs primary sites for a list of ids it already has from elsewhere.
 */
export async function listPrimarySitesForClients(
  clientIds: string[],
): Promise<ActionResult<{ sitesByClientId: Record<string, SiteRecord> }>> {
  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "clients", ["read", "read_own"])) {
    return fail("You do not have permission to view sites.");
  }

  const sitesByClientId: Record<string, SiteRecord> = {};
  if (clientIds.length === 0) return ok({ sitesByClientId });

  const supabase = await createSupabaseServerClient();
  // Explicit column projection (issue #149) — `client_id` is required (this
  // function's own grouping below keys the result by it), and `city`/
  // `country`/`phone` are all `ClientsTable`/`ClientsKanban` render (see
  // those components' own primary-site usage) — nothing else on this row is
  // read by any consumer of this bulk helper.
  const { data, error } = await supabase
    .from("sites")
    .select("id, client_id, city, country, phone")
    .in("client_id", clientIds)
    .eq("is_primary", true);

  if (error) return fail(mapDbError(error));
  for (const site of (data ?? []) as SiteRecord[]) {
    sitesByClientId[site.client_id] = site;
  }
  return ok({ sitesByClientId });
}

/**
 * Bulk counterpart to `listSites` for views that need EVERY site (not just
 * each client's primary one) across a set of clients in one shot — e.g. the
 * Assets map view (issue #82), which was doing one `listSites` round-trip
 * per distinct client among the currently-loaded assets (the same anti-
 * pattern `listPrimarySitesForClients` above fixed for the Clients kanban in
 * issue #75). Unlike that function, this can return more than one site per
 * client, so the result is a flat array — callers key it however they need
 * (e.g. by `id` for a pin map). Same RLS/permission boundary as `listSites`.
 */
export async function listSitesForClientIds(clientIds: string[]): Promise<ActionResult<{ sites: SiteRecord[] }>> {
  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "clients", ["read", "read_own"])) {
    return fail("You do not have permission to view sites.");
  }

  if (clientIds.length === 0) return ok({ sites: [] });

  const supabase = await createSupabaseServerClient();
  // Explicit column projection (issue #149) — two consumers now: the Assets
  // map view's pin-building (`assets-screen.tsx`'s `buildMapPins`, which
  // reads `id`/`latitude`/`longitude` for the pin plus `address_line1`/`city`
  // via `formatSiteAddressShort` for the pin label), and (issue #164,
  // Planning module) the scheduler board's `site_id -> region_id` lookup for
  // grouping backlog/scheduled work orders by region — `region_id` added to
  // this projection for that second consumer.
  const { data, error } = await supabase
    .from("sites")
    .select("id, address_line1, city, latitude, longitude, region_id")
    .in("client_id", clientIds);

  if (error) return fail(mapDbError(error));
  return ok({ sites: (data ?? []) as SiteRecord[] });
}

type SitePurposeKey = "is_visit_address" | "is_invoice_address" | "is_delivery_address";

const SITE_PURPOSE_KEYS: readonly SitePurposeKey[] = ["is_visit_address", "is_invoice_address", "is_delivery_address"];

const SITE_PURPOSE_LABELS: Record<SitePurposeKey, string> = {
  is_visit_address: "visit address",
  is_invoice_address: "invoice address",
  is_delivery_address: "delivery address",
};

/**
 * Cross-row invariant, deliberately NOT DB-enforced (see migration header of
 * `supabase/migrations/20260825090000_sites_addresses.sql`): across ALL of a
 * client's sites, each of `is_visit_address`/`is_invoice_address`/
 * `is_delivery_address` must be covered by at least one site (one site may
 * cover more than one). Given the purposes a write would drop off one site
 * and every *other* site for that client, returns the subset that would end
 * up covered by nothing (empty = safe to proceed).
 *
 * Deliberately only prevents a write from making things *worse* — some
 * pre-migration clients may already lack full coverage (their sites were
 * backfilled `is_visit_address = true` only), and that's expected; this
 * never retroactively requires full coverage before allowing any edit.
 */
function uncoveredPurposesAfterDrop(
  droppedPurposes: SitePurposeKey[],
  otherSites: Pick<SiteRecord, SitePurposeKey>[],
): SitePurposeKey[] {
  return droppedPurposes.filter((key) => !otherSites.some((site) => site[key] === true));
}

function uncoveredPurposesError(uncovered: SitePurposeKey[]): string {
  const names = uncovered.map((key) => SITE_PURPOSE_LABELS[key]).join(", ");
  const noun = uncovered.length === 1 ? "purpose" : "purposes";
  return `This client would be left with no site covering: ${names}. Assign that ${noun} to another site first.`;
}

function dedupeContactRoles(roles: readonly SiteContactRoleInput[] | undefined): SiteContactRoleInput[] {
  const seen = new Set<string>();
  const out: SiteContactRoleInput[] = [];
  for (const entry of roles ?? []) {
    const key = `${entry.contactId}:${entry.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function mapSiteContactRoleDbError(error: { code?: string; message: string }): string {
  if (error.code === "23514") {
    return "A contact must belong to this site's client, and a contact needs an e-mail address to be used for invoices or work receipts.";
  }
  return mapDbError(error);
}


/**
 * Replaces a site's contact matrix rows with `desired` without ever leaving
 * the site contact-less on failure: computes the diff against the current
 * rows, inserts the new rows first, then deletes the removed ones. Returns an
 * error message, or `null` on success. RLS (owner-only write) and the
 * `validate_site_contact_role` trigger (same client, e-mail for
 * invoice/work_receipt) are the backstops.
 */
async function replaceSiteContactRoles(
  supabase: SupabaseServerClient,
  siteId: string,
  desired: SiteContactRoleInput[],
): Promise<{ error: string | null; undo: () => Promise<void> }> {
  const noUndo = async () => {};
  const { data: current, error: currentError } = await supabase
    .from("site_contact_roles")
    .select("id, contact_id, role")
    .eq("site_id", siteId);
  if (currentError) return { error: mapDbError(currentError), undo: noUndo };

  const currentRows = (current ?? []) as { id: string; contact_id: string; role: SiteContactRole }[];
  const currentKeys = new Set(currentRows.map((r) => `${r.contact_id}:${r.role}`));
  const desiredKeys = new Set(desired.map((r) => `${r.contactId}:${r.role}`));

  const toInsert = desired.filter((r) => !currentKeys.has(`${r.contactId}:${r.role}`));
  const toDeleteIds = currentRows.filter((r) => !desiredKeys.has(`${r.contact_id}:${r.role}`)).map((r) => r.id);

  // Best-effort compensation for the caller: put the previous state back.
  const undo = async () => {
    const deletedRows = currentRows.filter((r) => toDeleteIds.includes(r.id));
    if (deletedRows.length > 0) {
      await supabase
        .from("site_contact_roles")
        .upsert(
          deletedRows.map((r) => ({ site_id: siteId, contact_id: r.contact_id, role: r.role })),
          { onConflict: "site_id,contact_id,role", ignoreDuplicates: true },
        );
    }
    for (const r of toInsert) {
      await supabase
        .from("site_contact_roles")
        .delete()
        .eq("site_id", siteId)
        .eq("contact_id", r.contactId)
        .eq("role", r.role);
    }
  };

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase
      .from("site_contact_roles")
      .insert(toInsert.map((r) => ({ site_id: siteId, contact_id: r.contactId, role: r.role })));
    if (insertError) return { error: mapSiteContactRoleDbError(insertError), undo: noUndo };
  }
  if (toDeleteIds.length > 0) {
    const { error: deleteError } = await supabase.from("site_contact_roles").delete().in("id", toDeleteIds);
    if (deleteError) return { error: mapDbError(deleteError), undo };
  }
  return { error: null, undo };
}

function toRecordContactRoles(roles: SiteContactRoleInput[]): SiteRecord["contact_roles"] {
  return roles.map((r) => ({ contact_id: r.contactId, role: r.role }));
}

export async function createSite(input: unknown): Promise<ActionResult<{ site: SiteRecord }>> {
  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "create")) {
    return fail("Only the organization owner can create sites.");
  }

  // Parsed against the un-refined base shape, not the refined
  // `siteCreateSchema` (see that schema's comment in `./schema.ts`): the
  // "first site for this client" override below must be able to force the
  // purpose flags to `true` even when the caller submitted none of them, so
  // the "at least one purpose" rule can't be allowed to reject the request
  // before that override gets a chance to run.
  const parsed = siteBaseSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();

  const { count, error: countError } = await supabase
    .from("sites")
    .select("id", { count: "exact", head: true })
    .eq("client_id", parsed.data.clientId);
  if (countError) return fail(mapDbError(countError));

  const isFirstSite = (count ?? 0) === 0;

  let purpose: { isVisitAddress: boolean; isInvoiceAddress: boolean; isDeliveryAddress: boolean; isPrimary: boolean };
  if (isFirstSite) {
    // App-layer invariant (not DB-enforced — see migration header): the
    // first site for a client always covers every purpose and is primary,
    // regardless of what the form submitted.
    purpose = { isVisitAddress: true, isInvoiceAddress: true, isDeliveryAddress: true, isPrimary: true };
  } else {
    purpose = {
      isVisitAddress: parsed.data.isVisitAddress ?? false,
      isInvoiceAddress: parsed.data.isInvoiceAddress ?? false,
      isDeliveryAddress: parsed.data.isDeliveryAddress ?? false,
      isPrimary: parsed.data.isPrimary ?? false,
    };
    if (!purpose.isVisitAddress && !purpose.isInvoiceAddress && !purpose.isDeliveryAddress) {
      return fail("Please fix the highlighted fields.", { isVisitAddress: [SITE_PURPOSE_REQUIRED_MESSAGE] });
    }
    // Issue #52: a checked purpose needs its matching contact person. Not
    // required for the forced-first-site branch above — see
    // `toSiteInsertRow`'s comment on why contacts stay independent of the
    // `purpose` override there.
    const submittedRoles = parsed.data.contactRoles;
    const roleErrors: Record<string, string[]> = {};
    if (purpose.isVisitAddress && !hasContactRole(submittedRoles, "visit")) {
      roleErrors["contactRoles.visit"] = [siteContactRequiredMessage("visit")];
    }
    if (purpose.isInvoiceAddress && !hasContactRole(submittedRoles, "invoice")) {
      roleErrors["contactRoles.invoice"] = [siteContactRequiredMessage("invoice")];
    }
    if (purpose.isDeliveryAddress && !hasContactRole(submittedRoles, "delivery")) {
      roleErrors["contactRoles.delivery"] = [siteContactRequiredMessage("delivery")];
    }
    if (Object.keys(roleErrors).length > 0) {
      return fail("Please fix the highlighted fields.", roleErrors);
    }
  }

  // Story requirement: "Pin op kaart wordt bepaald door adres gegevens, niet
  // latlong" — always geocode on create (there is no prior pin to preserve).
  // Never blocks the save: `geocodeAddress` never throws, and a `null` (no
  // match/failure) just leaves latitude/longitude/geocoded_at null.
  const geocoded = await geocodeAddress({
    addressLine1: parsed.data.addressLine1,
    postalCode: parsed.data.postalCode,
    city: parsed.data.city,
    // Country is optional as of issue #42 — `buildQuery` already drops any
    // falsy address part, same `?? ""` fallback `updateSite` below already
    // uses for its own (merged-with-existing) geocode call.
    country: parsed.data.country ?? "",
  });

  const { data, error } = await supabase
    .from("sites")
    .insert(toSiteInsertRow(parsed.data, purpose, geocoded))
    .select("*")
    .single();

  if (error) return fail(mapSiteDbError(error));

  const createdSite = data as SiteRecord;
  const desiredRoles = dedupeContactRoles(parsed.data.contactRoles);
  if (desiredRoles.length > 0) {
    const { error: roleError } = await replaceSiteContactRoles(supabase, createdSite.id, desiredRoles);
    if (roleError) {
      // Don't leave a site behind that the caller thinks failed: the contact
      // rows are part of creating it.
      await supabase.from("sites").delete().eq("id", createdSite.id);
      return fail(roleError);
    }
  }
  return ok({ site: { ...createdSite, contact_roles: toRecordContactRoles(desiredRoles) } });
}

/**
 * Updates a site and (when `contactRoles` is submitted) its contact matrix,
 * all-or-nothing as far as possible (no transaction across the two writes):
 *  - Normal edit: the matrix diff is written FIRST (insert new, delete removed).
 *    If that fails, or the site row update then fails, the previous matrix rows
 *    are restored (deleted rows re-inserted, inserted rows removed), so purpose
 *    flags are never saved without their contacts.
 *  - Reparent (`clientId` changes): the site row is updated first (a DB trigger
 *    clears the old client's roles), then the new roles are inserted. If that
 *    insert fails the error says "Site moved, but its contacts could not be saved".
 */
export async function updateSite(id: string, input: unknown): Promise<ActionResult<{ site: SiteRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid site id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "update")) {
    return fail("Only the organization owner can update sites.");
  }

  const parsed = siteUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();

  const { data: existing, error: existingError } = await supabase
    .from("sites")
    .select("*")
    .eq("id", idResult.data)
    .maybeSingle();
  if (existingError) return fail(mapDbError(existingError));
  if (!existing) return fail("Site not found, or you do not have permission to update it.");
  const existingSite = existing as SiteRecord;

  // "At least one purpose" can't be fully checked by the schema alone on a
  // partial update (it may omit all three flags, meaning "leave as-is") —
  // merge with the existing row's flags first. Mirrors
  // sites_at_least_one_purpose / SITE_PURPOSE_REQUIRED_MESSAGE.
  const mergedPurpose: Record<SitePurposeKey, boolean> = {
    is_visit_address: parsed.data.isVisitAddress ?? existingSite.is_visit_address,
    is_invoice_address: parsed.data.isInvoiceAddress ?? existingSite.is_invoice_address,
    is_delivery_address: parsed.data.isDeliveryAddress ?? existingSite.is_delivery_address,
  };
  if (!mergedPurpose.is_visit_address && !mergedPurpose.is_invoice_address && !mergedPurpose.is_delivery_address) {
    return fail("Please fix the highlighted fields.", { isVisitAddress: [SITE_PURPOSE_REQUIRED_MESSAGE] });
  }

  // Cross-row purpose coverage (app-layer invariant, not DB-enforced — see
  // uncoveredPurposesAfterDrop): if this update would drop a purpose this
  // site currently covers, another site for the same (origin) client must
  // still cover it, or the write is rejected. Re-parenting to a different
  // client (`clientId` changing) counts as dropping every purpose this site
  // currently covers from the origin client, regardless of what the merged
  // flags end up being on the row itself — the row leaves that client
  // entirely, so it can no longer cover anything for it.
  const isReparenting = parsed.data.clientId !== undefined && parsed.data.clientId !== existingSite.client_id;

  // A site leaving its client is no longer that (former) client's designated
  // primary. `enforce_single_primary_site` only fires `... OF is_primary
  // ...`, so a `client_id`-only change wouldn't otherwise touch `is_primary`
  // — and if the destination client already has its own primary site, both
  // rows would end up `is_primary = true` for the new `client_id`, tripping
  // `sites_one_primary_per_client_idx` (a raw, unmapped 23505). Force it off
  // here, regardless of what the update input submitted for `isPrimary` (same
  // "server enforces it regardless of submitted input" style as the
  // first-site-forces-all-flags override in `createSite`). If the caller
  // wants the site primary at its new client, that's a separate, explicit
  // follow-up update.
  if (isReparenting) {
    parsed.data.isPrimary = false;
  }

  // Issue #273: same "merge with existing, then require if the merged purpose
  // flag is true" treatment as `mergedPurpose` above, against the contact
  // matrix. Submitted `contactRoles` replace the site's rows; omitted keeps
  // them — except on reparent, where the old client's contacts can't carry
  // over, so the matrix is cleared unless resubmitted.
  const { data: existingRoleRows, error: existingRolesError } = await supabase
    .from("site_contact_roles")
    .select("contact_id, role")
    .eq("site_id", idResult.data);
  if (existingRolesError) return fail(mapDbError(existingRolesError));

  const rolesChange = parsed.data.contactRoles !== undefined || isReparenting;
  const desiredRoles: SiteContactRoleInput[] =
    parsed.data.contactRoles !== undefined
      ? dedupeContactRoles(parsed.data.contactRoles)
      : isReparenting
        ? []
        : ((existingRoleRows ?? []) as { contact_id: string; role: SiteContactRole }[]).map((r) => ({
            contactId: r.contact_id,
            role: r.role,
          }));

  const roleErrors: Record<string, string[]> = {};
  if (mergedPurpose.is_visit_address && !hasContactRole(desiredRoles, "visit")) {
    roleErrors["contactRoles.visit"] = [siteContactRequiredMessage("visit")];
  }
  if (mergedPurpose.is_invoice_address && !hasContactRole(desiredRoles, "invoice")) {
    roleErrors["contactRoles.invoice"] = [siteContactRequiredMessage("invoice")];
  }
  if (mergedPurpose.is_delivery_address && !hasContactRole(desiredRoles, "delivery")) {
    roleErrors["contactRoles.delivery"] = [siteContactRequiredMessage("delivery")];
  }
  if (Object.keys(roleErrors).length > 0) {
    return fail("Please fix the highlighted fields.", roleErrors);
  }

  const droppedPurposes = SITE_PURPOSE_KEYS.filter((key) => {
    if (existingSite[key] !== true) return false;
    return isReparenting || mergedPurpose[key] === false;
  });
  if (droppedPurposes.length > 0) {
    const { data: otherSites, error: otherSitesError } = await supabase
      .from("sites")
      .select("is_visit_address, is_invoice_address, is_delivery_address")
      .eq("client_id", existingSite.client_id)
      .neq("id", idResult.data);
    if (otherSitesError) return fail(mapDbError(otherSitesError));

    const uncovered = uncoveredPurposesAfterDrop(
      droppedPurposes,
      (otherSites ?? []) as Pick<SiteRecord, SitePurposeKey>[],
    );
    if (uncovered.length > 0) {
      return fail(uncoveredPurposesError(uncovered));
    }
  }

  // Geocode whenever any address field was part of the update input (per
  // spec — regardless of whether the value actually changed), using the
  // full merged address (existing value + this update's overrides), since
  // Nominatim needs a complete address, not just the changed field(s). A
  // miss (no match/failure) leaves latitude/longitude/geocoded_at unchanged
  // — see `toSiteUpdateRow`.
  const addressTouched =
    parsed.data.addressLine1 !== undefined ||
    parsed.data.addressLine2 !== undefined ||
    parsed.data.postalCode !== undefined ||
    parsed.data.city !== undefined ||
    parsed.data.country !== undefined;

  let geocoded: { latitude: number; longitude: number } | undefined;
  if (addressTouched) {
    geocoded =
      (await geocodeAddress({
        addressLine1: parsed.data.addressLine1 ?? existingSite.address_line1 ?? "",
        postalCode: parsed.data.postalCode ?? existingSite.postal_code ?? "",
        city: parsed.data.city ?? existingSite.city ?? "",
        country: parsed.data.country ?? existingSite.country ?? "",
      })) ?? undefined;
  }

  const row = toSiteUpdateRow(parsed.data, geocoded);
  if (Object.keys(row).length === 0 && !rolesChange) {
    return fail("No changes provided.");
  }

  const updateSiteRow = async (): Promise<ActionResult<{ site: SiteRecord }>> => {
    if (Object.keys(row).length === 0) return ok({ site: existingSite });
    const { data, error } = await supabase
      .from("sites")
      .update(row)
      .eq("id", idResult.data)
      .select("*")
      .maybeSingle();
    if (error) return fail(mapSiteDbError(error));
    if (!data) return fail("Site not found, or you do not have permission to update it.");
    return ok({ site: data as SiteRecord });
  };

  let updatedSite: SiteRecord;
  if (isReparenting) {
    // Reparent: the site row goes first (a DB trigger clears the old client's
    // roles), then the new roles are inserted.
    const siteResult = await updateSiteRow();
    if (!siteResult.data) return siteResult;
    updatedSite = siteResult.data.site;
    const { error: roleError } = await replaceSiteContactRoles(supabase, idResult.data, desiredRoles);
    if (roleError) return fail(`Site moved, but its contacts could not be saved: ${roleError}`);
  } else {
    // Matrix first, then the site row; if the site update fails the previous
    // matrix rows are restored.
    let undo: () => Promise<void> = async () => {};
    if (rolesChange) {
      const replaced = await replaceSiteContactRoles(supabase, idResult.data, desiredRoles);
      if (replaced.error) {
        await replaced.undo();
        return fail(replaced.error);
      }
      undo = replaced.undo;
    }
    const siteResult = await updateSiteRow();
    if (!siteResult.data) {
      await undo();
      return siteResult;
    }
    updatedSite = siteResult.data.site;
  }
  return ok({ site: { ...updatedSite, contact_roles: toRecordContactRoles(desiredRoles) } });
}

/**
 * Hard delete. `assets.site_id` also has `on delete cascade` — deleting a
 * site deletes its assets too. Unlike `deleteClient`, this repo's task list
 * doesn't call for a dedicated dependency-count helper for sites, but the
 * same cascade risk applies; `frontend-ui-engineer` can call
 * `listAssets({ siteId })` (see `app/(app)/assets/actions.ts`) to get an
 * accurate count/list for a confirmation dialog if a site delete UI needs
 * one — no separate helper needed since assets are already filterable by
 * `siteId`.
 *
 * Also enforces the same cross-row purpose-coverage invariant as
 * `updateSite` (see `uncoveredPurposesAfterDrop`): deleting a site that is
 * the client's only site covering some purpose is rejected.
 *
 * If the deleted site was `is_primary` and other sites remain for its
 * client, auto-promotes one of the remainder to primary (the earliest
 * `created_at`, same deterministic tie-break the migration's own backfill
 * uses — see `sites_addresses.sql`'s "Backfill" block) as a follow-up update
 * after the delete succeeds, rather than silently leaving the client with
 * zero primary sites (mirrors this codebase's existing pattern of primary
 * reassignment being automatic/system-managed, e.g.
 * `enforce_single_primary_site` auto-unsetting a prior primary on
 * insert/update). If the deleted site was the client's only site, there is
 * nothing to promote — a client can have zero sites.
 */
export async function deleteSite(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid site id.");

  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "clients", "delete")) {
    return fail("Only the organization owner can delete sites.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: existing, error: existingError } = await supabase
    .from("sites")
    .select("id, client_id, is_primary, is_visit_address, is_invoice_address, is_delivery_address")
    .eq("id", idResult.data)
    .maybeSingle();
  if (existingError) return fail(mapDbError(existingError));
  if (!existing) return fail("Site not found, or you do not have permission to delete it.");

  const droppedPurposes = SITE_PURPOSE_KEYS.filter((key) => existing[key] === true);
  if (droppedPurposes.length > 0) {
    const { data: otherSites, error: otherSitesError } = await supabase
      .from("sites")
      .select("is_visit_address, is_invoice_address, is_delivery_address")
      .eq("client_id", existing.client_id)
      .neq("id", idResult.data);
    if (otherSitesError) return fail(mapDbError(otherSitesError));

    const uncovered = uncoveredPurposesAfterDrop(
      droppedPurposes,
      (otherSites ?? []) as Pick<SiteRecord, SitePurposeKey>[],
    );
    if (uncovered.length > 0) {
      return fail(uncoveredPurposesError(uncovered));
    }
  }

  const { data, error } = await supabase
    .from("sites")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Site not found, or you do not have permission to delete it.");

  if (existing.is_primary) {
    const { data: remaining, error: remainingError } = await supabase
      .from("sites")
      .select("id")
      .eq("client_id", existing.client_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    // Best-effort: the delete itself already succeeded above, so a failure
    // to look up/promote a replacement primary here is not surfaced as a
    // failure of the delete — it would just leave the client without a
    // primary site until the next explicit "set as primary" action.
    if (!remainingError && remaining) {
      await supabase.from("sites").update({ is_primary: true }).eq("id", remaining.id);
    }
  }

  return ok({ deletedId: data.id as string });
}
