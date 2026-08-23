import { Tabs, TabsList, TabsPanel, TabsTab } from "@yourorg/ui";
import { listReferenceItems, type ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { ReferenceListManager } from "../components/reference-list-manager";

// This file is a Server Component (`ReferenceListsBoard` is `async`, doing
// its own data fetch), composing `Tabs` directly — so it MUST use the
// standalone `TabsList`/`TabsTab`/`TabsPanel` exports, not the
// `Tabs.List`/`Tabs.Tab`/`Tabs.Panel` property-access form (see the doc
// comment on `TabsTab` in `packages/ui/src/tabs.tsx`: that form resolves to
// `undefined` here because `Tabs` is a Client Component boundary, and a
// Server Component only ever sees a client-reference stub for it, which
// carries none of the real function's static properties). Verified live —
// the property-access form 500'd this exact route ("Element type is invalid
// ... got: undefined") past `npm run typecheck`/`build`, only caught by an
// authenticated request against a running server.

/**
 * One entry per tenant-configurable picklist (docs/ARCHITECTURE.md
 * "Tenant-configurable reference data"). Adding a future list (Phase 2's
 * Contract Type, say) is exactly one more entry here — `ReferenceListManager`
 * is already generic over `listKey`, not hand-built per list.
 */
const REFERENCE_LIST_SECTIONS = [
  {
    key: "asset_type",
    title: "Asset Type",
    description: "Equipment categories used across your assets — e.g. HVAC, Electrical, Generator.",
  },
  {
    key: "asset_status",
    title: "Asset Status",
    description: "Lifecycle states an asset can be in — e.g. Active, In Repair, Decommissioned.",
  },
  {
    key: "asset_subtype",
    title: "Asset Sub-type",
    description:
      "Finer-grained equipment categories, each scoped to one Asset Type — e.g. Compressor, Thermostat, and Ductwork all belong under HVAC.",
  },
  {
    key: "contact_role",
    title: "Contact Role",
    description: "Roles a client contact can have — e.g. Primary, Billing, Site manager, Technical.",
  },
  {
    key: "work_order_status",
    title: "Work Order Status",
    description: "Lifecycle stages a work order moves through — e.g. New, Scheduled, En Route, In Progress, Completed, Invoiced.",
  },
  {
    key: "work_order_priority",
    title: "Work Order Priority",
    description: "Urgency levels for a work order — e.g. Low, Normal, High, Urgent.",
  },
  {
    key: "contract_type",
    title: "Contract Type",
    description: "Kinds of service agreement — e.g. Maintenance, Service, Installation, Warranty.",
  },
  {
    key: "sla_tier",
    title: "SLA Tier",
    description:
      "Service level tiers, each scoped to one Contract Type — e.g. Standard, Priority, and Premium all belong under Maintenance.",
  },
  {
    key: "billing_terms",
    title: "Billing Terms",
    description: "How a contract is billed — e.g. Monthly, Quarterly, Annually, Per-visit, One-time.",
  },
] as const;

/**
 * The data-fetching heart of the Reference Lists screen, rendered inside a
 * `Suspense` boundary by `page.tsx` (docs/ARCHITECTURE.md "route-level
 * streaming") so the page shell (heading, back link) paints immediately.
 */
export async function ReferenceListsBoard({ canWrite }: { canWrite: boolean }) {
  const results = await Promise.all(
    REFERENCE_LIST_SECTIONS.map((section) => listReferenceItems(section.key)),
  );

  // Every section's items, keyed by its own `list_key` — looked up below for
  // whichever section turns out to be *dependent* (`parentListKey` non-null
  // in its own `listReferenceItems` result, e.g. `asset_subtype` ->
  // `asset_type`), so its parent-item picker/labels can be built from data
  // already fetched here rather than a second round trip. Works today
  // because every dependent list's declared parent is itself one of
  // `REFERENCE_LIST_SECTIONS` (true for `asset_subtype` -> `asset_type`); a
  // future dependent list whose parent ISN'T managed on this board would
  // need its own fetch instead.
  const itemsByListKey = new Map<string, ReferenceListItemRecord[]>(
    REFERENCE_LIST_SECTIONS.map((section, index) => [section.key, results[index]?.data?.items ?? []]),
  );
  const titleByListKey = new Map<string, string>(
    REFERENCE_LIST_SECTIONS.map((section) => [section.key, section.title]),
  );

  return (
    <Tabs defaultValue={REFERENCE_LIST_SECTIONS[0].key}>
      <TabsList aria-label="Reference lists">
        {REFERENCE_LIST_SECTIONS.map((section) => (
          <TabsTab key={section.key} value={section.key}>
            {section.title}
          </TabsTab>
        ))}
      </TabsList>

      {REFERENCE_LIST_SECTIONS.map((section, index) => {
        const parentListKey = results[index]?.data?.parentListKey ?? null;
        return (
          <TabsPanel key={section.key} value={section.key}>
            <ReferenceListManager
              listKey={section.key}
              title={section.title}
              description={section.description}
              items={results[index]?.data?.items ?? []}
              loadError={results[index]?.error}
              canWrite={canWrite}
              parentListKey={parentListKey}
              parentListTitle={parentListKey ? titleByListKey.get(parentListKey) ?? parentListKey : undefined}
              parentItems={parentListKey ? itemsByListKey.get(parentListKey) ?? [] : []}
            />
          </TabsPanel>
        );
      })}
    </Tabs>
  );
}
