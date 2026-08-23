import Link from "next/link";
import { Button } from "@yourorg/ui";

export interface CreateContractButtonProps {
  /** Pre-scopes the create page to a single client (`/contracts/new?clientId=...`)
   * — same `lockedClientId` shape as `CreateAssetButton`/`CreateWorkOrderButton`,
   * for a future client-scoped "New contract" entry point. */
  clientId?: string;
  label?: string;
}

/**
 * Owner/finance "New contract" trigger — navigates to the full-page create
 * form (`/contracts/new`, docs/ARCHITECTURE.md "Popup vs. full page — pick
 * by weight, not habit") rather than opening a `Dialog`. Rendered only when
 * `can(actor, "contracts", "create")` — a planner/engineer/administratie
 * never sees this, matching `createContract`'s own RBAC gate.
 */
export function CreateContractButton({ clientId, label }: CreateContractButtonProps) {
  const params = new URLSearchParams();
  if (clientId) params.set("clientId", clientId);
  const query = params.toString();

  return (
    <Link href={query ? `/contracts/new?${query}` : "/contracts/new"}>
      <Button type="button" variant="primary">
        {label ?? "New contract"}
      </Button>
    </Link>
  );
}
