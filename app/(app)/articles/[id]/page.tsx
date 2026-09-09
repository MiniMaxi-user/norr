import { ArticleScreen } from "../components/article-screen";
import { loadArticleScreenProps } from "./article-detail-loader";

export const metadata = { title: "Article details" };

interface ArticleDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Renders the shared `ArticleScreen` in `mode: "edit"` — the "view" of the
 * article detail screen's three routes (issue #123, converting the old
 * `ArticleFormPanel` slide-in into a real page). Every field is inline-
 * editable directly here, behind the hero's single page-level pencil (see
 * `article-screen.tsx`'s own module doc comment), for a caller with edit
 * rights; a caller without them (`readOnly`, from `loadArticleScreenProps`)
 * gets the exact same layout with the pencil omitted instead of a separate
 * read-only component.
 */
export default async function ArticleDetailPage({ params }: ArticleDetailPageProps) {
  const { id } = await params;
  const props = await loadArticleScreenProps(id);

  return (
    <ArticleScreen
      {...props}
      breadcrumbItems={[{ label: "Articles", href: "/articles" }, { label: props.article!.article_number }]}
    />
  );
}
