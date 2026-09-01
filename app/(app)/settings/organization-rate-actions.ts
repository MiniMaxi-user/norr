"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";

/**
 * Org-level default billing rate settings (issue #109 acceptance criterion
 * 4): `organizations.default_travel_article_id` / `default_work_article_id`
 * — layer 3 of `resolve_billing_rate`'s 4-layer precedence (client override
 * -> engineer override -> ORG DEFAULT -> unresolved), see
 * `supabase/migrations/20260901090000_work_order_auto_draft_quotes.sql`'s
 * header design note 1. Unlike `updateClientRateSettings`
 * (`app/(app)/clients/actions.ts`) / `updateTeamMemberRateSettings`
 * (`lib/team/actions.ts`), this is NOT the shared `rateOverrideSchema` shape
 * (`lib/rate-overrides/schema.ts`) — there is no `hasCustomRate` toggle and
 * no separate override price column at this layer; the price IS the linked
 * article's own live `sale_price`, read straight off the FK (see the
 * migration's own comment on `organizations.default_travel_article_id`). So
 * this is its own small two-field schema instead of reusing that one.
 *
 * **Permission — deviates from a literal "owner/planner" reading of the
 * issue brief.** `organizations` UPDATE RLS
 * (`organizations_update_owner`, baseline migration) is `is_org_owner`
 * ONLY — a planner attempting this write would be rejected by the database
 * regardless of what the application layer allowed, the same "RLS is the
 * real backstop" situation `mapDbError`'s own `42501` comment documents
 * elsewhere. Gating the mutating action here on `can(actor, "settings",
 * "update")` (owner-only, per `lib/rbac/permissions.ts`'s `settings` matrix
 * row: `owner: CRUD`, everyone else `READ_ONLY`) keeps the app-layer check
 * and the DB truth in agreement, rather than letting a planner attempt (and
 * always fail) a write the app layer nominally allowed — the same "does the
 * gap actually exist, or would the write just bounce off RLS" reasoning this
 * codebase applies throughout (see e.g. `updateClientRateSettings`'s /
 * `updateTeamMemberRateSettings`'s own owner-only gates, both already this
 * shape for the identical reason). Read access (`getOrganizationDefaultRateSettings`)
 * stays open to any org member that can read `settings` at all (every
 * tenant role) — this is a plain org-wide fallback rate, not sensitive
 * financial data restricted the way an individual override might be.
 *
 * Feature-gated on `"settings"` (already shipped — see `lib/rbac/features.ts`),
 * same module `lib/reference-lists/actions.ts` and the two rate-override
 * actions above already use for tenant-configurable org settings.
 */

const organizationDefaultRateSchema = z.object({
  defaultTravelArticleId: z.string().uuid("Invalid travel article.").nullable().optional(),
  defaultWorkArticleId: z.string().uuid("Invalid work article.").nullable().optional(),
});

export interface OrganizationDefaultRateSettings {
  defaultTravelArticleId: string | null;
  defaultWorkArticleId: string | null;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Defense-in-depth existence check, same pattern as
 * `validateClientRateOverrideArticle` (`app/(app)/clients/actions.ts`) /
 * `validateRateOverrideArticle` (`lib/team/actions.ts`) — RLS on `articles`
 * (any org member may SELECT) already scopes this lookup to the caller's own
 * organization, so a hit here also proves org membership. Backstopped either
 * way by the DB's own `validate_organization_default_rate_articles` trigger,
 * which this maps to a clean message rather than a raw `23514`/`23503`. */
async function validateOrganizationDefaultRateArticle(
  supabase: SupabaseServerClient,
  articleId: string,
  label: "travel" | "work",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.from("articles").select("id").eq("id", articleId).maybeSingle();
  if (error) return { ok: false, error: mapDbError(error) };
  if (!data) {
    return {
      ok: false,
      error: `Invalid default ${label} article — it does not exist, or it does not belong to your organization.`,
    };
  }
  return { ok: true };
}

/** Any org member (any tenant role has at least `read` on `settings`). */
export async function getOrganizationDefaultRateSettings(): Promise<ActionResult<OrganizationDefaultRateSettings>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;

  if (!can(actor, "settings", "read")) {
    return fail("You do not have permission to view organization rate settings.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("default_travel_article_id, default_work_article_id")
    .eq("id", organizationId)
    .maybeSingle<{ default_travel_article_id: string | null; default_work_article_id: string | null }>();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Organization not found.");

  return ok({
    defaultTravelArticleId: data.default_travel_article_id,
    defaultWorkArticleId: data.default_work_article_id,
  });
}

/**
 * Owner-only (see the module comment above for why this deviates from a
 * literal "owner/planner" permission and instead matches `organizations`'
 * own owner-only RLS). Each field is independently optional — passing just
 * `{ defaultTravelArticleId: "..." }` updates only that one, same partial-
 * update shape `toQuoteLineItemUpdateRow` documents in
 * `app/(app)/quotes/actions.ts`. Passing `null` for a field explicitly
 * clears that default back to "unresolved at this layer" (falls through to
 * layer 4 in `resolve_billing_rate` when neither a client nor an engineer
 * override applies either).
 */
export async function updateOrganizationDefaultRateSettings(
  input: unknown,
): Promise<ActionResult<OrganizationDefaultRateSettings>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;

  if (!can(actor, "settings", "update")) {
    return fail("Only the organization owner can update the organization's default billing rates.");
  }

  const parsed = organizationDefaultRateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();

  if (parsed.data.defaultTravelArticleId) {
    const check = await validateOrganizationDefaultRateArticle(
      supabase,
      parsed.data.defaultTravelArticleId,
      "travel",
    );
    if (!check.ok) return fail("Please fix the highlighted fields.", { defaultTravelArticleId: [check.error] });
  }
  if (parsed.data.defaultWorkArticleId) {
    const check = await validateOrganizationDefaultRateArticle(supabase, parsed.data.defaultWorkArticleId, "work");
    if (!check.ok) return fail("Please fix the highlighted fields.", { defaultWorkArticleId: [check.error] });
  }

  const row: Record<string, unknown> = {};
  if (parsed.data.defaultTravelArticleId !== undefined) {
    row.default_travel_article_id = parsed.data.defaultTravelArticleId ?? null;
  }
  if (parsed.data.defaultWorkArticleId !== undefined) {
    row.default_work_article_id = parsed.data.defaultWorkArticleId ?? null;
  }

  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const { data, error } = await supabase
    .from("organizations")
    .update(row)
    .eq("id", organizationId)
    .select("default_travel_article_id, default_work_article_id")
    .maybeSingle<{ default_travel_article_id: string | null; default_work_article_id: string | null }>();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Organization not found, or you do not have permission to update it.");

  return ok({
    defaultTravelArticleId: data.default_travel_article_id,
    defaultWorkArticleId: data.default_work_article_id,
  });
}
