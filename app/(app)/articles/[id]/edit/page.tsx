import { ArticleScreen } from "../../components/article-screen";
import { loadArticleScreenProps } from "../article-detail-loader";

export const metadata = { title: "Edit article" };

interface EditArticlePageProps {
  params: Promise<{ id: string }>;
}

/**
 * `/articles/[id]/edit` — renders the exact same `ArticleScreen` as
 * `/articles/[id]` (same shared `loadArticleScreenProps`, same props), with
 * one difference: `startInEditMode` is passed `true`, seeding `pageEditing`
 * so every section starts already in its inline-edit state instead of
 * requiring a click on the hero's own pencil first. `CreateArticleButton`
 * (`../../components/create-article-button.tsx`) navigates a just-created
 * article straight here so the caller can immediately fill in every
 * placeholder field and hit Save — there is no separate `/articles/new` form
 * page. This route has real, standing meaning beyond that one flow too: it's
 * simply "open this article ready to edit," useful any time a caller already
 * knows they want to edit rather than just look.
 */
export default async function EditArticlePage({ params }: EditArticlePageProps) {
  const { id } = await params;
  const props = await loadArticleScreenProps(id);

  return (
    <ArticleScreen
      {...props}
      startInEditMode
      breadcrumbItems={[{ label: "Articles", href: "/articles" }, { label: props.article.article_number }]}
    />
  );
}
