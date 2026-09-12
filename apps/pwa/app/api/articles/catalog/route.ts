import { NextResponse } from "next/server";
import { canAny } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { CatalogArticle } from "@/lib/work-orders/types";

/**
 * GET /api/articles/catalog — the org's active article catalog, for the
 * "Add article" bottom sheet on a work order's Articles tab (issue #170).
 * Same read pattern as `/api/workitems/today`/`/api/work-orders/[id]`:
 * resolve session -> `canAny(actor, "articles", ["read"])` (every tenant
 * role including engineer has plain `read` on Articles — see
 * `packages/rbac/src/permissions.ts`'s matrix) -> query under RLS
 * (`articles` is a member-readable table, no `assigned_to`-style scoping to
 * layer on top). Deliberately unpaginated, mirroring the root app's own
 * `listArticlesForSelect` (`app/(app)/articles/actions.ts`) — same
 * "org's article catalog is small enough for one client-filtered fetch"
 * reasoning.
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
  const { data, error } = await supabase
    .from("articles")
    .select("id, article_number, description")
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
