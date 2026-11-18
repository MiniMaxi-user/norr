"use client";

import { useMemo, useState } from "react";
import { Inline, Switch } from "@yourorg/ui";
import { WebDataTableCard, type WebColumn } from "@yourorg/ui/web-client";

/** Real shipped module names, matching `SHIPPED_FEATURES`/`FeatureKey` in
 * `lib/rbac/features.ts` (the story's own guidance: don't invent module
 * names). `dashboard`/`clients`/`settings`/`reporting`/`billing` are
 * deliberately left off this list — they're either not a sellable module
 * (`dashboard`, `settings`) or not shipped yet (`reporting`, `billing`), and
 * `clients` itself is the module this whole page already lives under. */
const STUB_MODULES: { key: string; label: string; description: string }[] = [
  { key: "assets", label: "Assets", description: "Equipment and asset tracking per site." },
  { key: "contracts", label: "Contracts", description: "Service agreements and recurring terms." },
  { key: "planning", label: "Work Orders", description: "Job scheduling and dispatch." },
  { key: "quotes", label: "Quotes", description: "Estimates and quote-to-work-order conversion." },
  { key: "checklists", label: "Checklists", description: "Inspection forms attached to work orders." },
];

/**
 * "Modules" tab on the Client detail page, platform-admin-only (issue #45) —
 * same visibility condition as the "Access" tab (see `client-detail.tsx`).
 *
 * Confirmed decision (see the issue #45 plan): this is a UI stub only. There
 * is no `organization_features` table yet, so every `Switch` below is purely
 * local `useState` — flipping one does not persist anywhere, has no server
 * action behind it, and reverts the moment this tab is left/reopened. The
 * note at the top says so explicitly so this never reads as a working
 * control by mistake.
 */
export function ModulesPanel() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(STUB_MODULES.map((module) => [module.key, true])),
  );

  const columns = useMemo<WebColumn<(typeof STUB_MODULES)[number]>[]>(
    () => [
      {
        id: "module",
        header: "Module",
        sortValue: (module) => module.label,
        render: (module) => (
          <>
            {module.label}
            <br />
            <span className="web-muted-cell">{module.description}</span>
          </>
        ),
      },
      {
        id: "enabled",
        header: "Enabled",
        render: (module) => (
          <Inline>
            <Switch
              aria-label={`Toggle ${module.label}`}
              checked={enabled[module.key] ?? false}
              onChange={(event) => setEnabled((prev) => ({ ...prev, [module.key]: event.currentTarget.checked }))}
            />
          </Inline>
        ),
      },
    ],
    [enabled],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "module",
        label: "Module",
        getOptions: (module: (typeof STUB_MODULES)[number]) => [{ value: module.key, label: module.label }],
      },
    ],
    [],
  );

  const segment = useMemo(
    () => ({
      label: "Show modules",
      defaultValue: "all",
      options: [
        { value: "on", label: "Enabled", match: (module: (typeof STUB_MODULES)[number]) => enabled[module.key] ?? false },
        { value: "off", label: "Disabled", match: (module: (typeof STUB_MODULES)[number]) => !(enabled[module.key] ?? false) },
        { value: "all", label: "All" },
      ] as const,
    }),
    [enabled],
  );

  return (
    <WebDataTableCard
      title="Modules"
      meta="preview"
      note="Module entitlements aren't persisted yet — this is a preview of the upcoming toggle UI. Flipping a switch here doesn't change what this tenant can actually access."
      rows={STUB_MODULES}
      getRowKey={(module) => module.key}
      columns={columns}
      searchText={(module) => `${module.label} ${module.description}`}
      noun="modules"
      dropdowns={dropdowns}
      segment={segment}
      urlPrefix="modules"
      defaultSort={{ columnId: "module", direction: "asc" }}
      rowLabel={(module) => module.label}
    />
  );
}
