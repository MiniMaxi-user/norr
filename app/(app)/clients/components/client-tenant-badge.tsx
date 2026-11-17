import { Badge } from "@yourorg/ui";
import type { ClientRecord } from "../actions";

/**
 * "Tenant" / "Tenant deactivated" badge for the Clients List and Kanban
 * (issue #220) — same labels/variants the client detail hero uses
 * (`../[id]/client-detail.tsx`). Renders nothing unless
 * `organization_is_active` is a boolean, which `listClients` only populates
 * for a Platform Admin; every other role (and every non-tenant client) gets
 * no badge.
 */
export function ClientTenantBadge({ client }: { client: Pick<ClientRecord, "organization_is_active"> }) {
  if (client.organization_is_active === true) return <Badge variant="success">Tenant</Badge>;
  if (client.organization_is_active === false) return <Badge variant="danger">Tenant deactivated</Badge>;
  return null;
}
