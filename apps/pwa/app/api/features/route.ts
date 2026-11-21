import { NextResponse } from "next/server";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { getEnabledFeatureKeys } from "@/lib/features/server";

/**
 * GET /api/features — the enabled feature keys of the engineer's
 * organization (issue #248). The PWA fetches this once per session and caches
 * it in Dexie (`meta`) for offline use; see `lib/features/use-features.tsx`.
 */
export async function GET() {
  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const orgId = session.organization?.id;
  const features = orgId ? Array.from(await getEnabledFeatureKeys(orgId)).sort() : [];
  return NextResponse.json({ features }, { headers: { "Cache-Control": "no-store" } });
}
