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
  /** Non-fatal: still renders the card (empty) with this message. */
  loadError?: string;
  /** Owner-only, per the `settings` RBAC entry. */
  canWrite: boolean;
}

/**
 * "Activity types" card (issue #165) embedded on the Activity subtypes page,
 * above the subtype tree: the same `ReferenceListManager` the standalone
 * `/settings/reference-lists/activity_type` route uses (same server actions),
 * with its own card title so it is told apart from the tree below it.
 */
export function ActivityTypesPanel({ items, loadError, canWrite }: ActivityTypesPanelProps) {
  return (
    <ReferenceListManager
      title="Activity types"
      description="Top-level categories used to classify each activity. Each value can carry a default work-item duration and a color, both reused later by the Planning module."
      listKey="activity_type"
      items={items}
      loadError={loadError}
      canWrite={canWrite}
      parentListKey={null}
      parentItems={[]}
      showDefaultDuration={getActivityTypeSection().showDefaultDuration}
    />
  );
}
