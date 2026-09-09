import { ArticleScreen } from "../components/article-screen";
import { loadArticleScreenProps } from "./article-detail-loader";

export const metadata = { title: "Article details" };

interface ArticleDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * `/articles/[id]` — the "landing" route for an existing article: renders
 * the shared `ArticleScreen` read-first, every field inline-editable behind
 * the hero's single page-level pencil (see `article-screen.tsx`'s own module
 * doc comment) for a caller with edit rights; a caller without them
 * (`readOnly`, from `loadArticleScreenProps`) gets the exact same layout with
 * the pencil omitted instead of a separate read-only component.
 *
 * Does NOT pass `startInEditMode` — unlike `../[id]/edit/page.tsx`, visiting
 * an existing article this way always starts read-only-until-clicked, same as
 * any other existing record.
 */
export default async function ArticleDetailPage({ params }: ArticleDetailPageProps) {
  const { id } = await params;
  const props = await loadArticleScreenProps(id);

  return (
    <ArticleScreen
      {...props}
      breadcrumbItems={[{ label: "Articles", href: "/articles" }, { label: props.article.article_number }]}
    />
  );
}
