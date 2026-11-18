import { ArticleScreen } from "../components/article-screen";
import { loadArticleScreenProps } from "./article-detail-loader";

export const metadata = { title: "Article details" };

interface ArticleDetailPageProps {
  params: Promise<{ id: string }>;
  /** `?tab=bom` deep-links straight to a tab. */
  searchParams: Promise<{ tab?: string }>;
}

/**
 * Renders the shared `ArticleScreen` (web design system, issue #222) in read
 * mode, with one Edit button for a caller with update rights — a caller
 * without them gets the same page with the button omitted entirely.
 */
export default async function ArticleDetailPage({ params, searchParams }: ArticleDetailPageProps) {
  const { id } = await params;
  const { tab } = await searchParams;
  const props = await loadArticleScreenProps(id, tab);

  return <ArticleScreen {...props} />;
}
