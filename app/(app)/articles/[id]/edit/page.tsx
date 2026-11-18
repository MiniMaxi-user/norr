import { redirect } from "next/navigation";

export const metadata = { title: "Edit article" };

interface EditArticlePageProps {
  params: Promise<{ id: string }>;
}

/**
 * `/articles/[id]/edit` — kept only so old links keep working. Editing is
 * inline on the detail page (one Edit button, `useEditMode`), so this route
 * just forwards to it; the detail page does its own `hasFeature()`/RBAC gating.
 */
export default async function EditArticlePage({ params }: EditArticlePageProps) {
  const { id } = await params;
  redirect(`/articles/${id}`);
}
