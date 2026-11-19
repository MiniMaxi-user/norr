"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { canAny } from "@/lib/rbac/permissions";

/**
 * Read side of the work order photos (issue #224). Photos are uploaded by the
 * field PWA into the private `work-order-photos` bucket with a row in
 * `work_order_photos`; RLS (owner/planner/finance/administratie: all in org,
 * engineer: assigned work orders only) and the storage policies do the real
 * scoping — this only runs under the caller's own session, never the service
 * role. It rides on the `planning` module's read/read_own, no module of its own.
 */

export interface WorkOrderPhotoRecord {
  id: string;
  taken_at: string;
  content_type: string;
  width: number | null;
  height: number | null;
  uploader_name: string | null;
  /** Signed URL, valid for one hour — fine since it is rendered per request. */
  url: string;
}

const uuidSchema = z.string().uuid("Invalid id.");
const SIGNED_URL_TTL_SECONDS = 3600;

interface PhotoRow {
  id: string;
  storage_path: string;
  content_type: string;
  width: number | null;
  height: number | null;
  taken_at: string;
  uploader: { email: string; full_name: string | null } | null;
}

/** Photos of one work order, oldest first, each with a signed URL (one
 * `createSignedUrls` call for the whole batch). */
export async function listWorkOrderPhotos(
  workOrderId: string,
): Promise<ActionResult<{ photos: WorkOrderPhotoRecord[] }>> {
  const idResult = uuidSchema.safeParse(workOrderId);
  if (!idResult.success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);
  if (!canAny(ctx.context.actor, "planning", ["read", "read_own"])) {
    return fail("You do not have permission to view photos.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_order_photos")
    .select("id, storage_path, content_type, width, height, taken_at, uploader:users(email, full_name)")
    .eq("work_order_id", idResult.data)
    .order("taken_at", { ascending: true })
    .returns<PhotoRow[]>();
  if (error) return fail(mapDbError(error));

  const rows = data ?? [];
  if (rows.length === 0) return ok({ photos: [] });

  const { data: signed, error: signError } = await supabase.storage
    .from("work-order-photos")
    .createSignedUrls(
      rows.map((row) => row.storage_path),
      SIGNED_URL_TTL_SECONDS,
    );
  if (signError) return fail("Could not load the photos.");

  const urlByPath = new Map<string, string>();
  for (const entry of signed ?? []) {
    if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl);
  }

  const photos: WorkOrderPhotoRecord[] = rows.flatMap((row) => {
    const url = urlByPath.get(row.storage_path);
    if (!url) return [];
    return [
      {
        id: row.id,
        taken_at: row.taken_at,
        content_type: row.content_type,
        width: row.width,
        height: row.height,
        uploader_name: row.uploader ? row.uploader.full_name?.trim() || row.uploader.email : null,
        url,
      },
    ];
  });
  return ok({ photos });
}
