import Link from "next/link";
import { Button, type ButtonSize } from "@yourorg/ui";

export interface CreateContractButtonProps {
  /** Pre-scopes the create page to a single client (`/contracts/new?clientId=...`,
   * which pre-fills the client there) — same `lockedClientId` shape as
   * `CreateAssetButton`/`CreateWorkOrderButton`, used both by a future
   * client-scoped entry point and (issue #113 follow-up) the Clients detail
   * page's own Contracts tab. */
  clientId?: string;
  label?: string;
  /** The standalone Contracts module page's own toolbar button wants the
   * default (larger) size; the Clients detail page's Contracts tab
   * (`contracts-panel.tsx`) passes `"sm"` to match every other tab's
   * `SectionHeader` "+ X" button there — same `size` convention
   * `CreateAssetButton`/`CreateWorkOrderButton` already use. */
  size?: ButtonSize;
}

/**
 * Owner/finance "New contract" trigger — navigates to the full-page create
 * form (`/contracts/new`, docs/ARCHITECTURE.md "Popup vs. full page — pick
 * by weight, not habit") rather than opening a `Dialog`. Rendered only when
 * `can(actor, "contracts", "create")` — a planner/engineer/administratie
 * never sees this, matching `createContract`'s own RBAC gate.
 */
export function CreateContractButton({ clientId, label, size }: CreateContractButtonProps) {
  const params = new URLSearchParams();
  if (clientId) params.set("clientId", clientId);
  const query = params.toString();

  return (
    <Link href={query ? `/contracts/new?${query}` : "/contracts/new"}>
      <Button type="button" variant="primary" size={size}>
        {label ?? "New contract"}
      </Button>
    </Link>
  );
}
