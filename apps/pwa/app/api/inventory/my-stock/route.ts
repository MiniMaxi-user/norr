import { NextResponse } from "next/server";
import { canAny } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { MyStockItem, MyStockResponse } from "@/lib/inventory/types";

/**
 * GET /api/inventory/my-stock — the calling engineer's own warehouse stock,
 * for the PWA "Voorraad" profile view and its manual sync (issue #182).
 * Same session -> `canAny(actor, "inventory", ["read_own"])` -> RLS-scoped-
 * query pattern as every other route in this app — `inventory`'s `engineer`
 * matrix row grants only `read_own` (`packages/rbac/src/permissions.ts`),
 * matching `warehouse_stock_select_scoped`'s own "engineer reads own rows
 * only" RLS shape (`20260916090000_warehouses_and_stock.sql`).
 *
 * Scoping: `warehouse_stock` denormalizes the owning engineer's `user_id`
 * directly on each row (that migration's design note 4), so a plain
 * `.eq("user_id", session.userId)` is "which rows", not a substitute for
 * RLS — same convention `/api/articles/catalog` and
 * `/api/engineer/hours-this-week` already use. Runs through the normal
 * request-scoped (RLS-respecting) client, never service-role — this is a
 * plain "read my own rows" case RLS already permits.
 *
 * Deliberately includes quantity-0 rows (AC: "ook als voorraad 0 is" — no
 * `.gt("quantity", 0)` filter) and deliberately never selects
 * `purchase_price`/`sale_price` at all (AC: "Engineer ziet geen prijs") —
 * omitted from the `select()` itself, not just hidden client-side.
 */
const MY_STOCK_SELECT = `
  id, article_id, quantity, min_threshold, last_counted_at,
  article:articles!warehouse_stock_article_id_fkey(
    article_number, description,
    article_unit:reference_list_items!articles_unit_item_id_fkey(label)
  )
`;

interface MyStockRow {
  id: string;
  article_id: string;
  quantity: number;
  min_threshold: number | null;
  last_counted_at: string | null;
  article: {
    article_number: string;
    description: string;
    article_unit: { label: string } | null;
  } | null;
}

export async function GET() {
  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  if (!canAny({ role: session.role }, "inventory", ["read_own"])) {
    return NextResponse.json({ error: "You do not have permission to view stock." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouse_stock")
    .select(MY_STOCK_SELECT)
    .eq("user_id", session.userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("GET /api/inventory/my-stock: failed to load stock", error);
    return NextResponse.json({ error: "Failed to load your stock." }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as MyStockRow[];
  const stock: MyStockItem[] = rows.map((row) => ({
    id: row.id,
    articleId: row.article_id,
    articleNumber: row.article?.article_number ?? "",
    description: row.article?.description ?? "",
    unit: row.article?.article_unit?.label ?? null,
    quantity: row.quantity,
    minThreshold: row.min_threshold,
    lastCountedAt: row.last_counted_at,
  }));

  const response: MyStockResponse = { stock };
  return NextResponse.json(response);
}
