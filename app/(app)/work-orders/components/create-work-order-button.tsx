import Link from "next/link";
import { Button } from "@yourorg/ui";

export interface CreateWorkOrderButtonProps {
  /** Pre-scopes the create page to a single client (`/work-orders/new?clientId=...`)
   * — same `lockedClientId` shape as `CreateAssetButton`, for a future
   * client-scoped "New work order" entry point. */
  clientId?: string;
  label?: string;
}

/**
 * Owner/planner "New work order" trigger — navigates to the full-page create
 * form (`/work-orders/new`, docs/ARCHITECTURE.md "Popup vs. full page — pick
 * by weight, not habit") rather than opening a `Dialog`. Rendered only when
 * `can(actor, "planning", "create")` — an engineer never sees this, matching
 * `createWorkOrder`'s own RBAC gate.
 */
export function CreateWorkOrderButton({ clientId, label }: CreateWorkOrderButtonProps) {
  const params = new URLSearchParams();
  if (clientId) params.set("clientId", clientId);
  const query = params.toString();

  return (
    <Link href={query ? `/work-orders/new?${query}` : "/work-orders/new"}>
      <Button type="button" variant="primary">
        {label ?? "New work order"}
      </Button>
    </Link>
  );
}
