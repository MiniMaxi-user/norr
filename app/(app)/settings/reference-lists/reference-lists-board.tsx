import { Tabs, TabsList, TabsPanel, TabsTab } from "@yourorg/ui";
import { listReferenceItems } from "@/lib/reference-lists/actions";
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

  return (
    <Tabs defaultValue={REFERENCE_LIST_SECTIONS[0].key}>
      <TabsList aria-label="Reference lists">
        {REFERENCE_LIST_SECTIONS.map((section) => (
          <TabsTab key={section.key} value={section.key}>
            {section.title}
          </TabsTab>
        ))}
      </TabsList>

      {REFERENCE_LIST_SECTIONS.map((section, index) => (
        <TabsPanel key={section.key} value={section.key}>
          <ReferenceListManager
            listKey={section.key}
            title={section.title}
            description={section.description}
            items={results[index]?.data?.items ?? []}
            loadError={results[index]?.error}
            canWrite={canWrite}
          />
        </TabsPanel>
      ))}
    </Tabs>
  );
}
