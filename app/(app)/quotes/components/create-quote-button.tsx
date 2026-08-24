import Link from "next/link";
import { Button } from "@yourorg/ui";

export interface CreateQuoteButtonProps {
  /** Pre-scopes the create page to a single client (`/quotes/new?clientId=...`)
   * — same `lockedClientId` shape as `CreateContractButton`/`CreateAssetButton`,
   * for a future client-scoped "New quote" entry point. */
  clientId?: string;
  label?: string;
}

/**
 * Owner/planner "New quote" trigger — navigates to the full-page create form
 * (`/quotes/new`, docs/ARCHITECTURE.md "Popup vs. full page — pick by
 * weight, not habit") rather than opening a `Dialog`. Rendered only when
 * `can(actor, "quotes", "create")` — an engineer/finance/administratie never
 * sees this, matching `createQuote`'s own RBAC gate.
 */
export function CreateQuoteButton({ clientId, label }: CreateQuoteButtonProps) {
  const params = new URLSearchParams();
  if (clientId) params.set("clientId", clientId);
  const query = params.toString();

  return (
    <Link href={query ? `/quotes/new?${query}` : "/quotes/new"}>
      <Button type="button" variant="primary">
        {label ?? "New quote"}
      </Button>
    </Link>
  );
}
