"use client";

import { useRouter } from "next/navigation";
import { Button } from "@yourorg/ui";

/**
 * Server-side pagination over `listClients({ limit, offset })` (list view
 * and kanban view both currently render this same single fetched page —
 * see the note on `ClientsExplorer` for why kanban isn't board-wide yet).
 * Navigates via `?page=` so the Server Component in `page.tsx` re-fetches
 * the requested page behind its `Suspense` boundary.
 *
 * Not a plain `<Link>` pair: a disabled `Button` nested inside a `<Link>`
 * would still be clickable via the wrapping `<a>`, so the boundary case
 * (first/last page) is handled with `router.push` gated on `disabled`
 * instead.
 */
export function ClientsPagination({
  page,
  pageSize,
  count,
}: {
  page: number;
  pageSize: number;
  count: number;
}) {
  const router = useRouter();
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  if (totalPages <= 1) return null;

  const canGoPrevious = page > 1;
  const canGoNext = page < totalPages;

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canGoPrevious}
        onClick={() => router.push(`/clients?page=${page - 1}`)}
      >
        Previous
      </Button>{" "}
      <span>
        Page {page} of {totalPages}
      </span>{" "}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canGoNext}
        onClick={() => router.push(`/clients?page=${page + 1}`)}
      >
        Next
      </Button>
    </div>
  );
}
