import { ArticleScreen } from "../../components/article-screen";
import { loadArticleScreenProps } from "../article-detail-loader";

export const metadata = { title: "Edit article" };

interface EditArticlePageProps {
  params: Promise<{ id: string }>;
}

/**
 * `/articles/[id]/edit` — kept only as an alias route onto the exact same
 * `ArticleScreen` render as `/articles/[id]` (issue #123, mirroring the
 * Assets precedent: "not a distinct mode, just another route rendering it").
 * There is no separate "edit mode" anymore: editing happens inline, per
 * section, on the detail page itself — see `../article-detail-loader.ts`
 * (shared by both routes) and `article-screen.tsx`'s own module doc comment.
 */
export default async function EditArticlePage({ params }: EditArticlePageProps) {
  const { id } = await params;
  const props = await loadArticleScreenProps(id);

  return (
    <ArticleScreen
      {...props}
      breadcrumbItems={[{ label: "Articles", href: "/articles" }, { label: props.article!.article_number }]}
    />
  );
}
