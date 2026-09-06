import Link from "next/link";
import { Button } from "@yourorg/ui";

/**
 * Owner/administratie "Add article" trigger (issue #123) — a plain `Link` to
 * `/articles/new`, the real create page, replacing the old slide-in
 * `ArticleFormPanel` in create mode (see `docs/ARCHITECTURE.md`'s "Popup vs.
 * full page" section). A Server Component now — no panel `open` state to own
 * anymore, same simplification the Assets/Activities equivalents went
 * through when they made this same move.
 */
export function CreateArticleButton() {
  return (
    <Link href="/articles/new">
      <Button type="button" variant="primary">
        Add article
      </Button>
    </Link>
  );
}
