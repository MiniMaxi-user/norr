import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { listAssetModels, listVolumeCounterOptions } from "@/lib/asset-models/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { AssetModelManager } from "../components/asset-model-manager";

export const metadata = { title: "Asset Model" };

/**
 * Promoted out of the old Reference Lists tab board into its own top-level
 * leaf (issue #110, Settings admin shell stage 3) — same "single async
 * page.tsx, no Suspense" shape `../reference-lists/[listKey]/page.tsx`
 * established, since this is at most 4 lightweight queries, not heavy enough
 * to stream around. The `"settings"` feature/module gate itself already ran
 * in `app/(app)/settings/layout.tsx` before this page could render — only
 * `canWrite` is computed here.
 */
export default async function AssetModelsPage() {
  const session = await getCurrentSession();
  const actor: PermissionActor = { role: session?.role ?? null, isPlatformAdmin: session?.isPlatformAdmin ?? false };
  const canWrite = can(actor, "settings", "create");

  const [modelsResult, brandResult, typeResult, subtypeResult, volumeResult] = await Promise.all([
    listAssetModels(),
    listReferenceItems("asset_brand"),
    listReferenceItems("asset_type"),
    listReferenceItems("asset_subtype"),
    listVolumeCounterOptions(),
  ]);

  return (
      <AssetModelManager
        models={modelsResult.data?.models ?? []}
        loadError={modelsResult.error}
        canWrite={canWrite}
        brandItems={brandResult.data?.items ?? []}
        typeItems={typeResult.data?.items ?? []}
        subtypeItems={subtypeResult.data?.items ?? []}
        volumeOptions={volumeResult.data?.items ?? []}
      />
  );
}
