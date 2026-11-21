"use client";

import { useMemo, useRef, useState } from "react";
import { Button, Dialog, Heading, Inline, Stack, Switch, Text, toast } from "@yourorg/ui";
import { WebCard, WebCardSection, WebCardStack, WebStatusBadge } from "@yourorg/ui/web";
import type { ActionResult } from "@/lib/actions/result";
import type { ModuleChanges, ModuleRow } from "@/lib/modules/module-rows";
import {
  addonModules,
  cascadeForToggle,
  coreModules,
  MODULE_CATALOG,
  type CatalogFeatureKey,
} from "@/lib/rbac/module-catalog";

export interface ModuleToggleListProps {
  /** Rows as returned by the list RPC (one per catalog key). */
  rows: ModuleRow[];
  /** Saves ONE change set (the toggled key plus any cascaded keys) and returns the refreshed rows. */
  onSave: (changes: ModuleChanges) => Promise<ActionResult<{ rows: ModuleRow[] }>>;
  /** Show the change source ("Manual" / "Default") in the per-row note. The default bundle has none. */
  showSource?: boolean;
}

const SOURCE_LABELS: Record<string, string> = { manual: "Manual", stripe: "Stripe", default: "Default" };

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Amsterdam",
});

function changedNote(row: ModuleRow | undefined, showSource: boolean): string | null {
  if (!row || !row.updatedAt) return null;
  const parts: string[] = [];
  if (row.updatedByName) parts.push(`Changed by ${row.updatedByName}`);
  parts.push(dateFormat.format(new Date(row.updatedAt)));
  if (showSource && row.source) parts.push(SOURCE_LABELS[row.source] ?? row.source);
  return parts.join(" · ");
}

function joinLabels(keys: CatalogFeatureKey[]): string {
  const labels = keys.map((key) => MODULE_CATALOG[key].label);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

interface PendingConfirm {
  key: CatalogFeatureKey;
  enabled: boolean;
  changes: ModuleChanges;
  affected: CatalogFeatureKey[];
}

/**
 * Shared module switch list (#245 tenant Modules tab, #246 default bundle):
 * Core / Add-ons groups from `MODULE_CATALOG`, optimistic switches with revert +
 * error toast, a cascade confirm dialog, disabled core switches and "Coming
 * soon" for modules that aren't shipped. The dependency rules are the same ones
 * the DB RPC enforces (`cascadeForToggle`).
 */
export function ModuleToggleList({ rows, onSave, showSource = true }: ModuleToggleListProps) {
  const [byKey, setByKey] = useState<Map<CatalogFeatureKey, ModuleRow>>(
    () => new Map(rows.map((row) => [row.key, row])),
  );
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const byKeyRef = useRef(byKey);
  byKeyRef.current = byKey;

  const enabledSet = useMemo(
    () => new Set<string>([...byKey.values()].filter((row) => row.enabled).map((row) => row.key)),
    [byKey],
  );

  async function apply(changes: ModuleChanges) {
    const previous = byKeyRef.current;
    const optimistic = new Map(previous);
    for (const [key, value] of Object.entries(changes) as [CatalogFeatureKey, boolean][]) {
      const current = optimistic.get(key);
      optimistic.set(key, { ...(current ?? { key, source: null, updatedAt: null, updatedByName: null }), key, enabled: value });
    }
    setByKey(optimistic);
    setPending(true);
    const result = await onSave(changes);
    setPending(false);
    if (result.error || !result.data) {
      setByKey(previous);
      toast({ tone: "danger", title: "Could not save modules", description: result.error ?? "Please try again." });
      return;
    }
    setByKey(new Map(result.data.rows.map((row) => [row.key, row])));
  }

  function handleToggle(key: CatalogFeatureKey, enabled: boolean) {
    const cascade = cascadeForToggle(enabledSet, key, enabled);
    if (cascade.error) {
      toast({ tone: "danger", title: "Not allowed", description: cascade.error });
      return;
    }
    if (Object.keys(cascade.changes).length === 0) return;
    if (cascade.affected.length > 0) {
      setConfirm({ key, enabled, changes: cascade.changes, affected: cascade.affected });
      return;
    }
    void apply(cascade.changes);
  }

  function renderRow(key: CatalogFeatureKey) {
    const def = MODULE_CATALOG[key];
    const row = byKey.get(key);
    const isCore = def.tier === "core";
    const comingSoon = !def.shipped;
    const note = changedNote(row, showSource);
    return (
      <WebCardSection key={key}>
        <Inline justify="between" align="start" gap="md">
          <Stack gap="xs">
            <Inline gap="sm">
              <Text>
                <strong>{def.label}</strong>
              </Text>
              {comingSoon ? <span id={`module-${key}-coming-soon`}><WebStatusBadge tone="neutral">Coming soon</WebStatusBadge></span> : null}
            </Inline>
            <Text tone="muted">{def.description}</Text>
            {isCore ? <Text id={`module-${key}-core`} tone="muted">Core module &mdash; always included</Text> : null}
            {def.requires.length > 0 ? <Text tone="muted">Requires {joinLabels(def.requires)}</Text> : null}
            {note ? <Text tone="muted">{note}</Text> : null}
          </Stack>
          <Switch
            aria-label={`${def.label} module`}
            aria-describedby={isCore ? `module-${key}-core` : comingSoon ? `module-${key}-coming-soon` : undefined}
            checked={isCore ? true : (row?.enabled ?? false)}
            disabled={isCore || comingSoon || pending}
            onChange={(event) => handleToggle(key, event.currentTarget.checked)}
          />
        </Inline>
      </WebCardSection>
    );
  }

  const coreKeys = coreModules();
  const addonKeys = addonModules();

  return (
    <>
      <WebCardStack>
        <WebCard title="Core" meta={`${coreKeys.length}`}>
          {coreKeys.map(renderRow)}
        </WebCard>
        <WebCard title="Add-ons" meta={`${addonKeys.filter((key) => enabledSet.has(key)).length} of ${addonKeys.length} enabled`}>
          {addonKeys.map(renderRow)}
        </WebCard>
      </WebCardStack>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)} size="sm">
        <Dialog.Header>
          <Heading level={3}>
            {confirm?.enabled ? "Enable" : "Disable"} {confirm ? MODULE_CATALOG[confirm.key].label : ""}?
          </Heading>
        </Dialog.Header>
        <Dialog.Body>
          {confirm ? (
            <Text tone="muted">
              {confirm.enabled
                ? `${MODULE_CATALOG[confirm.key].label} requires ${joinLabels(confirm.affected)}, which will also be enabled.`
                : `${joinLabels(confirm.affected)} ${confirm.affected.length === 1 ? "depends" : "depend"} on ${MODULE_CATALOG[confirm.key].label} and will also be disabled.`}
            </Text>
          ) : null}
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={confirm?.enabled ? "primary" : "danger"}
            onClick={() => {
              const changes = confirm?.changes;
              setConfirm(null);
              if (changes) void apply(changes);
            }}
          >
            {confirm?.enabled ? "Enable" : "Disable"}
          </Button>
        </Dialog.Footer>
      </Dialog>
    </>
  );
}
