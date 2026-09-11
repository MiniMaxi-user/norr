import { Card, Heading, Stack, Text } from "@yourorg/ui";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { REFERENCE_LIST_SECTIONS } from "../reference-lists/sections";
import { ReferenceListManager } from "./reference-list-manager";

function getActivityTypeSection() {
  const section = REFERENCE_LIST_SECTIONS.find((candidate) => candidate.key === "activity_type");
  if (!section) {
    throw new Error("REFERENCE_LIST_SECTIONS is missing its required 'activity_type' entry");
  }
  return section;
}

export interface ActivityTypesPanelProps {
  items: ReferenceListItemRecord[];
  /** Non-fatal — same "still render with whatever it got" convention every
   * other manager on this board uses for its own `loadError`. */
  loadError?: string;
  /** Owner-only, per the `settings` RBAC entry — matches
   * `ReferenceListManager`'s own gate for every other list. */
  canWrite: boolean;
}

/**
 * Compact "Activity Types" panel (issue #165, "Op activity subtypes wordt
 * ook Activity type getoond") embedded directly on
 * `../activity-subtypes/page.tsx`, above the subtype tree — Activity Type had
 * no place to be managed at all before this ("er is nu geen plek voor. Er is
 * wel plek voor de sub types"). Deliberately just a titled `Card` wrapping
 * the exact same `ReferenceListManager` the standalone
 * `/settings/reference-lists/activity_type` route (`../reference-lists/
 * [listKey]/page.tsx`) uses, scoped to `list_key = "activity_type"` — both
 * routes read/write through the same `listReferenceItems`/
 * `createReferenceItem`/`updateReferenceItem` server actions, so there is no
 * second CRUD implementation to keep in sync. `activity_type` is a
 * root-level, non-dependent list (`parentListKey: null`, `parentItems: []`),
 * same as every other non-dependent list passed to this manager.
 */
export function ActivityTypesPanel({ items, loadError, canWrite }: ActivityTypesPanelProps) {
  return (
    <Card>
      <Stack gap="md">
        <Stack gap="xs">
          <Heading level={3}>Activity Types</Heading>
          <Text tone="muted">
            Top-level categories used to classify each Activity. Each value can carry a default work-item duration
            and a color, both reused later by the Planning module.
          </Text>
        </Stack>
        <ReferenceListManager
          listKey="activity_type"
          items={items}
          loadError={loadError}
          canWrite={canWrite}
          parentListKey={null}
          parentItems={[]}
          showDefaultDuration={getActivityTypeSection().showDefaultDuration}
        />
      </Stack>
    </Card>
  );
}
