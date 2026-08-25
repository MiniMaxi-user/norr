"use client";

import { useState } from "react";
import { Card, Inline, Stack, Switch, Table, Text } from "@yourorg/ui";

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

  return (
    <Stack gap="md">
      <Card>
        <Text tone="muted">
          Module entitlements aren&apos;t persisted yet — this is a preview of the upcoming toggle UI. Flipping a
          switch here doesn&apos;t change what this tenant can actually access.
        </Text>
      </Card>

      <Table>
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell>Module</Table.HeaderCell>
            <Table.HeaderCell align="center">Enabled</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {STUB_MODULES.map((module) => (
            <Table.Row key={module.key}>
              <Table.Cell>
                <Stack gap="xs">
                  <Text>{module.label}</Text>
                  <Text tone="muted">{module.description}</Text>
                </Stack>
              </Table.Cell>
              <Table.Cell align="center">
                <Inline justify="center">
                  <Switch
                    aria-label={`Toggle ${module.label}`}
                    checked={enabled[module.key] ?? false}
                    onChange={(event) =>
                      setEnabled((prev) => ({ ...prev, [module.key]: event.currentTarget.checked }))
                    }
                  />
                </Inline>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </Stack>
  );
}
