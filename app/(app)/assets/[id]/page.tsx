import { AssetScreen } from "../components/asset-screen";
import { loadAssetScreenProps } from "./asset-detail-loader";

export const metadata = { title: "Asset details" };

interface AssetDetailPageProps {
  params: Promise<{ id: string }>;
  /** `?tab=volumes` etc. deep-links straight to a tab. */
  searchParams: Promise<{ tab?: string }>;
}

/**
 * Renders the shared `AssetScreen` (web design system, issue #222): read
 * mode with one Edit button for a caller with update rights — a caller
 * without them gets the same page with the button omitted entirely.
 */
export default async function AssetDetailPage({ params, searchParams }: AssetDetailPageProps) {
  const { id } = await params;
  const { tab } = await searchParams;
  const props = await loadAssetScreenProps(id, tab);

  return <AssetScreen {...props} />;
}
