import { NextResponse } from "next/server";
import { canAny } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { CatalogArticle } from "@/lib/work-orders/types";

/**
 * GET /api/articles/catalog — the calling engineer's OWN stocked article
 * catalog, for the "Add article" bottom sheet on a work order's Articles tab
 * (issue #170, narrowed by issue #182's AC "Alleen voorraad artikelen van de
 * engineer worden naar pwa gesynced" / "Bij toevoegen artikelen in pwa
 * worden alleen artikelen van de engineer getoond"). Same read pattern as
 * `/api/workitems/today`/`/api/work-orders/[id]`: resolve session ->
 * `canAny(actor, "articles", ["read"])` (every tenant role including
 * engineer has plain `read` on Articles — see
 * `packages/rbac/src/permissions.ts`'s matrix) -> query under RLS.
 *
 * Scoping: `warehouse_stock` denormalizes the owning engineer's `user_id`
 * directly on each row (`20260916090000_warehouses_and_stock.sql` design
 * note 4), and its `warehouse_stock_select_scoped` RLS policy already
 * restricts an engineer to reading only their own rows — so a plain
 * `.eq("user_id", session.userId)` here is "which rows", not a substitute
 * for RLS, same convention as `/api/engineer/hours-this-week`. Two-step
 * fetch (stocked article ids, then the active articles matching them)
 * rather than one join, since `warehouse_stock` has no active-flag of its
 * own to filter on and this keeps the "still-active only" filter on the
 * `articles` table itself, exactly like this route's prior unscoped
 * version. An engineer with zero stocked articles gets back an empty list,
 * not the old org-wide catalog — that's the intended #182 behavior, not a
 * bug.
 */
export async function GET() {
  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  if (!canAny({ role: session.role }, "articles", ["read"])) {
    return NextResponse.json({ error: "You do not have permission to view articles." }, { status: 403 });
  }

  const supabase = await createClient();

  const stockResult = await supabase
    .from("warehouse_stock")
    .select("article_id")
    .eq("user_id", session.userId);

  if (stockResult.error) {
    console.error("GET /api/articles/catalog: failed to load the engineer's stock", stockResult.error);
    return NextResponse.json({ error: "Failed to load the article catalog." }, { status: 500 });
  }

  const articleIds = Array.from(
    new Set((stockResult.data ?? []).map((row) => (row as { article_id: string }).article_id)),
  );

  if (articleIds.length === 0) {
    return NextResponse.json({ articles: [] });
  }

  const { data, error } = await supabase
    .from("articles")
    .select("id, article_number, description")
    .in("id", articleIds)
    .eq("is_active", true)
    .order("article_number", { ascending: true });

  if (error) {
    console.error("GET /api/articles/catalog: failed to load articles", error);
    return NextResponse.json({ error: "Failed to load the article catalog." }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as { id: string; article_number: string; description: string }[];
  const articles: CatalogArticle[] = rows.map((row) => ({
    id: row.id,
    articleNumber: row.article_number,
    description: row.description,
  }));

  return NextResponse.json({ articles });
}
