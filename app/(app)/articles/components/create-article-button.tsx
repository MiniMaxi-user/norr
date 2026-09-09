"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Text } from "@yourorg/ui";
import { createArticle } from "../actions";

/**
 * Owner/administratie "Add article" trigger — mirrors `CreateContractButton`
 * (`app/(app)/contracts/components/create-contract-button.tsx`)'s "create a
 * bare record immediately, then navigate to its own detail page" shape:
 * there is no `/articles/new` form page anymore (deleted along with this
 * component's own old `Link`-to-`/articles/new` shape). Clicking creates a
 * placeholder article right away and navigates straight to
 * `/articles/[id]/edit` — NOT the bare `/articles/[id]` — so the new record
 * lands with every section already in its inline-edit state (`startInEditMode`
 * on `ArticleScreen`), ready for the caller to immediately overwrite every
 * placeholder field and hit the one Save button, instead of requiring an
 * extra click on the hero's own pencil first.
 *
 * `article_number` needs real entropy, unlike Contracts' fixed "New contract"
 * name placeholder: `articles` has `unique (organization_id, article_number)`
 * at the DB level, so a second click (or a second admin, concurrently) with
 * the same fixed literal would collide and fail `createArticle`. `description`
 * has no such constraint, so a fixed placeholder is fine there.
 */
export function CreateArticleButton() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setCreating(true);
    const result = await createArticle({
      articleNumber: `NEW-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      description: "New article",
    });
    setCreating(false);
    if (!result.data) {
      setError(result.error ?? "Could not create this article.");
      return;
    }
    router.push(`/articles/${result.data.article.id}/edit`);
  }

  return (
    <>
      <Button type="button" variant="primary" onClick={handleClick} disabled={creating}>
        {creating ? "Creating…" : "Add article"}
      </Button>
      {error && <Text tone="danger">{error}</Text>}
    </>
  );
}
