"use client";

import { WebCard, WebDataTableEmpty } from "@yourorg/ui/web";
import { ModuleToggleList } from "@/components/modules/module-toggle-list";
import type { ModuleChanges, ModuleRow } from "@/lib/modules/module-rows";
import { setTenantModules } from "../module-actions";

/**
 * "Modules" tab on the Client detail page, platform-admin-only (issues
 * #45/#245) - same visibility condition as the "Access" tab. Real per-tenant
 * entitlements (`organization_features`): the rows are loaded server-side in
 * `page.tsx` and every switch saves immediately through `setTenantModules`
 * (one change set per toggle, including cascaded dependencies).
 */
export function ModulesPanel({ clientId, rows }: { clientId: string; rows: ModuleRow[] }) {
  if (rows.length === 0) {
    return (
      <WebCard title="Modules">
        <WebDataTableEmpty>Could not load this tenant&rsquo;s modules. Reload the page to try again.</WebDataTableEmpty>
      </WebCard>
    );
  }
  return <ModuleToggleList rows={rows} onSave={(changes: ModuleChanges) => setTenantModules(clientId, changes)} />;
}
