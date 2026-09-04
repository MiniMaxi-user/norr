import { AssetScreen } from "../../components/asset-screen";
import { loadAssetScreenProps } from "../asset-detail-loader";

export const metadata = { title: "Edit Asset" };

interface EditAssetPageProps {
  params: Promise<{ id: string }>;
}

/**
 * `/assets/[id]/edit` — kept only as an alias route onto the exact same
 * `AssetScreen` render as `/assets/[id]` (asset new/edit design handoff v3:
 * "not a distinct mode, just another route rendering it"). There is no
 * separate "edit mode" anymore: editing happens inline, per section, on the
 * detail page itself — see `../asset-detail-loader.ts` (shared by both
 * routes) and `asset-screen.tsx`'s own module doc comment.
 */
export default async function EditAssetPage({ params }: EditAssetPageProps) {
  const { id } = await params;
  const props = await loadAssetScreenProps(id);

  return (
    <AssetScreen
      {...props}
      breadcrumbItems={[{ label: "Assets", href: "/assets" }, { label: props.asset!.name }]}
    />
  );
}
