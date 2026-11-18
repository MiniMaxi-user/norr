import Link from "next/link";
import { Button } from "@yourorg/ui";

/**
 * Owner/administratie "Add article" trigger — navigates to the full-page
 * `/articles/new` create page (web design system, issue #222) instead of
 * creating a bare placeholder article first. A plain Server Component `<Link>`
 * (no state to own).
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
