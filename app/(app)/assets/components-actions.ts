"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { assetComponentAddSchema, assetComponentUpdateSchema } from "./schema";
import type { ResolvedReferenceItem } from "./actions";

/**
 * Server Actions for a composite Asset's bill-of-materials
 * (`asset_components`, issue #125) — a sub-resource of one Asset, kept in its
 * own file the same "sub-resource gets its own file" split
 * `app/(app)/articles/components-actions.ts` uses for `article_components`.
 *
 * *** This is a DIFFERENT concept from Articles' composite-article BOM. ***
 * An Article is a catalog/product row — the same article can be a component
 * of unlimited different composite recipes. An Asset is a single physical,
 * individually tracked instance, so a physical asset can only ever be part of
 * ONE parent assembly at a time — enforced by a plain `unique
 * (component_asset_id)` constraint on `asset_components` (see
 * `supabase/migrations/20260906100000_asset_components.sql`'s design note for
 * the full reasoning). That uniqueness is what makes "walk up to find this
 * asset's root" a single linear chain (never a fan-out) — see
 * `getAssetCompositionTree` below.
 *
 * Gated on the same `"assets"` RBAC module as `./actions.ts` — a component
 * link is configuration data about the asset itself, not a separate RBAC row.
 * Per this feature's task instructions: `asset_components` write RLS
 * (`asset_components_insert_owner`/`update_owner`/`delete_owner`) is
 * OWNER-ONLY — NOT the owner-or-administratie shape Articles' own
 * `article_components` uses, and narrower than what `can(actor, "assets",
 * "update")` alone would suggest for a Planner (see the "Known gap" module
 * comment in `./actions.ts`: Planner has `assets` update in the RBAC matrix,
 * but real RLS on `assets`/its sub-resources is owner-only for writes today).
 * `addAssetComponent`/`updateAssetComponent`/`removeAssetComponent` all gate
 * on `can(actor, "assets", "update")` — the same action `updateAsset` itself
 * already uses, and the same "attempt it anyway, let RLS be the real
 * backstop, `if (!data) return fail(...)` covers the silent-Planner-rejection
 * case" posture `./actions.ts` documents at length. Not re-litigated here.
 *
 * The cycle/self-reference/cross-organization shape is entirely enforced by
 * the DB's `validate_asset_component` trigger (arbitrary-depth, reflexive
 * descendant walk) — not re-validated here, per this task's scope;
 * `mapAssetComponentDbError` below turns its `23514` rejection into a clean
 * message.
 */

const uuidSchema = z.string().uuid("Invalid id.");

/** Shallow display shape for an asset embedded on a BOM line or tree node —
 * just enough for a row/badge in the UI (name, serial number, status), same
 * "shallow embed, not the full `AssetRecord`" precedent
 * `ArticleComponentLineRecord.component_article` sets in
 * `app/(app)/articles/actions.ts`. */
export interface AssetComponentAssetInfo {
  id: string;
  name: string;
  serial_number: string | null;
  status_id: string;
  asset_status: ResolvedReferenceItem | null;
}

/** Same select shape used for every query below that embeds a component
 * asset's display info — kept as a literal (not re-exported from
 * `./actions.ts`) since it's a deliberately shallow subset of that file's own
 * `ASSET_SELECT`. `assets_status_id_fkey` is the same FK name `ASSET_SELECT`
 * itself relies on. */
const COMPONENT_ASSET_INFO_SELECT =
  "id,name,serial_number,status_id,asset_status:reference_list_items!assets_status_id_fkey(value,label,color)";

export interface AssetComponentLineRecord {
  id: string;
  organization_id: string;
  parent_asset_id: string;
  component_asset_id: string;
  quantity: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded basic display fields for the component asset. `null` should
   * never actually happen (the DB FK cascades — a component row can't outlive
   * its component asset), but modeled as nullable defensively like every
   * other embed in this codebase (see `ArticleComponentLineRecord`'s own
   * `component_article` field comment). */
  component_asset: AssetComponentAssetInfo | null;
}

const ASSET_COMPONENT_SELECT = `*, component_asset:assets!asset_components_component_asset_id_fkey(${COMPONENT_ASSET_INFO_SELECT})`;

/**
 * Lists an asset's own direct components (one level — not the whole
 * composition tree; see `getAssetCompositionTree` for that). Any org member
 * with `assets` read access may call this.
 */
export async function listAssetComponents(
  parentAssetId: string,
): Promise<ActionResult<{ components: AssetComponentLineRecord[] }>> {
  const idResult = uuidSchema.safeParse(parentAssetId);
  if (!idResult.success) return fail("Invalid asset id.");

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "assets", "read")) {
    return fail("You do not have permission to view this asset's components.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("asset_components")
    .select(ASSET_COMPONENT_SELECT)
    .eq("parent_asset_id", idResult.data)
    .order("created_at", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ components: (data ?? []) as AssetComponentLineRecord[] });
}

/**
 * Maps a DB error from an `asset_components` write to a clean, user-safe
 * message. Adds two cases on top of the shared `mapDbError`:
 *  - the arbitrary-depth cycle rejection `validate_asset_component` raises
 *    (`23514`, matched on its distinctive message text since `23514` is also
 *    used for the unrelated cross-organization guard — see `mapDbError`'s own
 *    comment on why that code is overloaded);
 *  - the `unique (component_asset_id)` violation (`23505`) raised when an
 *    asset that's already installed somewhere else is added again.
 * Same "local error mapping on top of the shared one" precedent
 * `mapArticleComponentDbError`/`mapSiteDbError`/`mapChecklistDbError`
 * establish elsewhere in this codebase.
 */
function mapAssetComponentDbError(error: { code?: string; message: string }): string {
  if (error.code === "23514" && error.message.includes("would create a cycle in the asset composition tree")) {
    return "Adding this asset as a component would create a circular assembly (it — or something it's already installed inside — already contains this asset higher up the chain).";
  }
  if (error.code === "23505") {
    return "This asset is already installed as a component of another assembly — remove it there first.";
  }
  return mapDbError(error);
}

/**
 * Owner-only in practice (see the module comment above) — `can(actor,
 * "assets", "update")` gates entry the same way `updateAsset` does;
 * `parent_asset_id` is fixed to `parentAssetId`, `component_asset_id`/
 * `quantity` come from `input`.
 */
export async function addAssetComponent(
  parentAssetId: string,
  input: unknown,
): Promise<ActionResult<{ component: AssetComponentLineRecord }>> {
  const idResult = uuidSchema.safeParse(parentAssetId);
  if (!idResult.success) return fail("Invalid asset id.");

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "assets", "update")) {
    return fail("You do not have permission to add components to this asset.");
  }

  const parsed = assetComponentAddSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("asset_components")
    .insert({
      parent_asset_id: idResult.data,
      component_asset_id: parsed.data.componentAssetId,
      quantity: parsed.data.quantity,
    })
    .select(ASSET_COMPONENT_SELECT)
    .single();

  if (error) return fail(mapAssetComponentDbError(error));
  return ok({ component: data as AssetComponentLineRecord });
}

/**
 * Quantity is the only mutable field — `parent_asset_id`/`component_asset_id`
 * are insert-only (excluded from the DB's UPDATE column grant, see the
 * migration's grant comments); to change either side, delete this row
 * (`removeAssetComponent`) and `addAssetComponent` again.
 */
export async function updateAssetComponent(
  id: string,
  input: unknown,
): Promise<ActionResult<{ component: AssetComponentLineRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid component id.");

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "assets", "update")) {
    return fail("You do not have permission to update this component.");
  }

  const parsed = assetComponentUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("asset_components")
    .update({ quantity: parsed.data.quantity })
    .eq("id", idResult.data)
    .select(ASSET_COMPONENT_SELECT)
    .maybeSingle();

  if (error) return fail(mapAssetComponentDbError(error));
  if (!data) return fail("Component not found, or you do not have permission to update it.");
  return ok({ component: data as AssetComponentLineRecord });
}

/** Owner-only in practice (see the module comment above). */
export async function removeAssetComponent(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid component id.");

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "assets", "update")) {
    return fail("You do not have permission to remove this component.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("asset_components")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Component not found, or you do not have permission to remove it.");
  return ok({ deletedId: data.id as string });
}

// ---------------------------------------------------------------------------
// Composition tree
// ---------------------------------------------------------------------------

/** One flattened `asset_components` link row, as fetched for the whole
 * composition-tree build below — `parent_asset_id` is kept (unlike
 * `AssetComponentLineRecord`, which doesn't need it since it's always queried
 * already scoped to one parent) so `getAssetCompositionTree` can group every
 * link in the organization by its own `parent_asset_id` in one pass, the same
 * `byParent` map precedent `app/(app)/articles/group-tree.ts`'s
 * `buildArticleGroupTree` sets for `article_groups`. */
interface AssetComponentTreeLinkRow {
  id: string;
  parent_asset_id: string;
  component_asset_id: string;
  quantity: number;
  component_asset: AssetComponentAssetInfo | null;
}

const ASSET_COMPONENT_TREE_LINK_SELECT = `id,parent_asset_id,component_asset_id,quantity,component_asset:assets!asset_components_component_asset_id_fkey(${COMPONENT_ASSET_INFO_SELECT})`;

export interface AssetComponentTreeNode {
  asset: AssetComponentAssetInfo;
  /** How many units of this asset its own parent consumes, per the
   * `asset_components` row linking it in — `null` for the root node (a root
   * has no parent, so no quantity is meaningful). */
  quantity: number | null;
  /** The `asset_components.id` of the row linking this node to its parent —
   * `null` for the root, same reasoning as `quantity`. Lets the frontend
   * offer an "edit quantity"/"remove" action straight off a tree node without
   * a second lookup. */
  componentRowId: string | null;
  /** Whether this node is the asset `getAssetCompositionTree` was originally
   * called with — the frontend highlights this one, per the issue's own
   * "clearly indicate which asset in the tree is the current one" acceptance
   * criterion. */
  isCurrent: boolean;
  children: AssetComponentTreeNode[];
}

/**
 * Given any asset id, returns its WHOLE composition tree — always rooted at
 * the true top of the assembly chain, never just the subtree below
 * `assetId` — with `currentAssetId` (and the matching node's `isCurrent`)
 * marking which node the caller actually asked about, per this issue's
 * acceptance criteria ("always show the whole tree, always show the root,
 * clearly indicate which asset in the tree is the current one").
 *
 * Two phases:
 *  1. Walk UP via `component_asset_id = <current>` one hop at a time — at
 *     most one row can ever match per hop (`asset_components.component_asset_id`
 *     is unique across the whole table), so this is always a single linear
 *     chain, never a fan-out — until an asset with no parent link is reached.
 *     That's the tree's root. Depth-capped defensively at 100 even though a
 *     cycle should be structurally impossible post-trigger.
 *  2. From that root, fetch every `asset_components` row in the organization
 *     in one query (RLS already scopes it) and assemble the whole tree
 *     downward in TypeScript — real fan-out this time (one asset can have
 *     many components) — same "one flattish fetch + assemble in TS"
 *     precedent `app/(app)/articles/group-tree.ts` sets for `article_groups`.
 *
 * A leaf asset with no components and no parent still returns a valid
 * single-node tree (root === the asset itself, no children) — that's a
 * legitimate, common state (most assets are not part of any composite), not
 * an error.
 */
export async function getAssetCompositionTree(
  assetId: string,
): Promise<ActionResult<{ tree: AssetComponentTreeNode; currentAssetId: string }>> {
  const idResult = uuidSchema.safeParse(assetId);
  if (!idResult.success) return fail("Invalid asset id.");

  const ctx = await requireModuleContext("assets");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "assets", "read")) {
    return fail("You do not have permission to view this asset's composition.");
  }

  const supabase = await createSupabaseServerClient();

  // Confirm the starting asset exists (RLS-scoped to the caller's org) up
  // front, and grab its own display info in case it turns out to BE the
  // root (no parent) — avoids a redundant second lookup for that common
  // case.
  const { data: startAsset, error: startError } = await supabase
    .from("assets")
    .select(COMPONENT_ASSET_INFO_SELECT)
    .eq("id", idResult.data)
    .maybeSingle();
  if (startError) return fail(mapDbError(startError));
  if (!startAsset) return fail("Asset not found.");

  // Phase 1: walk UP to find the root. Single linear chain (see the function
  // comment above) — never a fan-out.
  let rootId: string = idResult.data;
  for (let depth = 0; depth < 100; depth++) {
    const { data: parentLink, error: parentError } = await supabase
      .from("asset_components")
      .select("parent_asset_id")
      .eq("component_asset_id", rootId)
      .maybeSingle();
    if (parentError) return fail(mapDbError(parentError));
    if (!parentLink) break;
    rootId = parentLink.parent_asset_id as string;
  }

  const rootAsset =
    rootId === idResult.data
      ? (startAsset as unknown as AssetComponentAssetInfo)
      : await (async (): Promise<AssetComponentAssetInfo | null> => {
          const { data, error } = await supabase
            .from("assets")
            .select(COMPONENT_ASSET_INFO_SELECT)
            .eq("id", rootId)
            .maybeSingle();
          if (error) return null;
          return (data as unknown as AssetComponentAssetInfo) ?? null;
        })();
  if (!rootAsset) return fail("Asset composition tree could not be resolved.");

  // Phase 2: fetch every link in the organization in one query, then group
  // by `parent_asset_id` and assemble downward from `rootId`.
  const { data: rows, error: rowsError } = await supabase
    .from("asset_components")
    .select(ASSET_COMPONENT_TREE_LINK_SELECT);
  if (rowsError) return fail(mapDbError(rowsError));

  const links = (rows ?? []) as unknown as AssetComponentTreeLinkRow[];
  const byParent = new Map<string, AssetComponentTreeLinkRow[]>();
  for (const link of links) {
    const list = byParent.get(link.parent_asset_id);
    if (list) list.push(link);
    else byParent.set(link.parent_asset_id, [link]);
  }

  function buildNode(
    asset: AssetComponentAssetInfo,
    quantity: number | null,
    componentRowId: string | null,
  ): AssetComponentTreeNode {
    const children = (byParent.get(asset.id) ?? [])
      .filter((link) => link.component_asset !== null)
      .map((link) => buildNode(link.component_asset as AssetComponentAssetInfo, link.quantity, link.id));
    return {
      asset,
      quantity,
      componentRowId,
      isCurrent: asset.id === idResult.data,
      children,
    };
  }

  const tree = buildNode(rootAsset, null, null);
  return ok({ tree, currentAssetId: idResult.data });
}
