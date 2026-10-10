import "server-only";

import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Contract article coverage lookup (issue #208) — which of `articleIds` are
 * covered by `contractId`'s Included/Excluded rules, so their sales price is
 * 0 on the work order and its quote. The rule itself (article + group-tree
 * walk-up, Excluded overrules Included) lives in ONE place, the
 * `contract_covered_article_ids` SQL function, which the auto-draft quote
 * sync triggers use too — this helper only calls it, never re-derives it.
 *
 * Plain helper module, not a `"use server"` file — same reasoning as
 * `lib/quotes/auto-draft.ts`'s header comment.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function getContractCoveredArticleIds(
  supabase: SupabaseServerClient,
  contractId: string | null | undefined,
  articleIds: readonly string[],
): Promise<{ coveredIds: Set<string>; error: { code?: string; message: string } | null }> {
  const distinctIds = Array.from(new Set(articleIds));
  if (!contractId || distinctIds.length === 0) return { coveredIds: new Set(), error: null };

  const { data, error } = await supabase.rpc("contract_covered_article_ids", {
    p_contract_id: contractId,
    p_article_ids: distinctIds,
  });
  if (error) return { coveredIds: new Set(), error };

  return { coveredIds: new Set(((data ?? []) as unknown[]).map(toArticleId)), error: null };
}

/** A `returns setof uuid` RPC comes back as bare strings; tolerate the
 * `{ contract_covered_article_ids: uuid }` row shape too. */
function toArticleId(row: unknown): string {
  if (typeof row === "string") return row;
  return String((row as Record<string, unknown>).contract_covered_article_ids);
}
