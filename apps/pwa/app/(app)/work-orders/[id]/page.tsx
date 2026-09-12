import { getCurrentEngineerSession } from "@/lib/auth/session";
import { WorkOrderDetailScreen } from "./work-order-detail";

/**
 * Work-order detail route (issue #170, IMPLEMENTATION.md §1/§4) —
 * `/work-orders/[id]?section=hours|articles|photos|sign` (default
 * `details`). Stays a thin Server Component, same shape as `today/page.tsx`
 * — the real screen (fetch, timer, sections, offline reads) is the client
 * `WorkOrderDetailScreen`, which reads `?section=` itself via
 * `useSearchParams()` rather than this page threading it through as a prop,
 * so switching sections via the bottom bar's `Link`s (query-param-only
 * navigations) never remounts/re-fetches this screen — see that file's own
 * doc comment.
 */
export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentEngineerSession();
  // The layout above already redirects to /login when there's no valid
  // engineer session — see today/page.tsx's identical comment on this same
  // (in practice unreachable) null case.
  if (!session) return null;

  return (
    <WorkOrderDetailScreen
      workOrderId={id}
      currentUserId={session.userId}
      engineerName={session.fullName ?? session.email}
    />
  );
}
