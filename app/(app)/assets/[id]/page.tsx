import { AssetScreen } from "../components/asset-screen";
import { loadAssetScreenProps } from "./asset-detail-loader";

export const metadata = { title: "Asset details" };

interface AssetDetailPageProps {
  params: Promise<{ id: string }>;
  /** `?tab=volumes` deep-links straight to the Volumes tab. */
  searchParams: Promise<{ tab?: string }>;
}

/**
 * Renders the shared `AssetScreen` in `mode: "edit"` — the "view" of the
 * asset new/edit design handoff v3's three routes. Every field is inline-
 * editable directly here, behind the hero's single page-level pencil (see
 * `asset-screen.tsx`'s own module doc comment), for a caller with edit
 * rights; a caller without them (`readOnly`, from `loadAssetScreenProps`)
 * gets the exact same layout with the pencil omitted instead of a separate
 * read-only component.
 */
export default async function AssetDetailPage({ params, searchParams }: AssetDetailPageProps) {
  const { id } = await params;
  const { tab } = await searchParams;
  const props = await loadAssetScreenProps(id);

  return (
    <AssetScreen
      {...props}
      defaultTab={tab === "volumes" && props.volumes ? "volumes" : "details"}
      breadcrumbItems={[{ label: "Assets", href: "/assets" }, { label: props.asset!.name }]}
    />
  );
}
