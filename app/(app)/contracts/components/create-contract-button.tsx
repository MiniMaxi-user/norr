import Link from "next/link";
import { Button, type ButtonSize } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";

export interface CreateContractButtonProps {
  /** Pre-scopes (and locks, via `/contracts/new?clientId=...`) the contract's
   * client — passed by the Clients detail page's Contracts tab. Omitted on
   * the standalone Contracts page, where the new page asks for the client. */
  clientId?: string;
  label?: string;
  /** The standalone Contracts module page wants the default (larger) size. */
  size?: ButtonSize;
  /** Renders the design system's FilterBar add button (secondary, 30px,
   * "+ X" text, no icon) instead of the standard `Button` — used by the
   * related-list tabs of a detail page (issue #222). */
  filterBar?: boolean;
}

/**
 * Owner/finance "New contract" trigger — rendered only when
 * `can(actor, "contracts", "create")`, matching `createContract`'s own RBAC
 * gate. Navigates to the full-page `/contracts/new` (the contract screen in
 * new mode) instead of creating a bare contract and jumping to its detail
 * page. A plain Server Component `<Link>`: no state to own.
 */
export function CreateContractButton({ clientId, label, size, filterBar }: CreateContractButtonProps) {
  const href = clientId ? `/contracts/new?clientId=${encodeURIComponent(clientId)}` : "/contracts/new";

  return (
    <Link href={href}>
      {filterBar ? (
        <WebButton size="filter">{label ?? "New contract"}</WebButton>
      ) : (
        <Button type="button" variant="primary" size={size}>
          {label ?? "New contract"}
        </Button>
      )}
    </Link>
  );
}
