import { AssetScreen } from "../components/asset-screen";
import { loadAssetScreenProps } from "./asset-detail-loader";

export const metadata = { title: "Asset details" };

interface AssetDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Renders the shared `AssetScreen` in `mode: "edit"` — the "view" of the
 * asset new/edit design handoff v3's three routes. Every field is inline-
 * editable directly here (per section, via `EditableSection`'s own pencil)
 * for a caller with edit rights; a caller without them (`readOnly`, from
 * `loadAssetScreenProps`) gets the exact same layout with every pencil
 * omitted instead of a separate read-only component.
 */
export default async function AssetDetailPage({ params }: AssetDetailPageProps) {
  const { id } = await params;
  const props = await loadAssetScreenProps(id);

  return (
    <AssetScreen
      {...props}
      breadcrumbItems={[{ label: "Assets", href: "/assets" }, { label: props.asset!.name }]}
    />
  );
}
