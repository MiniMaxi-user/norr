"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, DefinitionList, Dialog, Heading, Inline, Stack, Text, useEscapeToClose } from "@yourorg/ui";
import type { ActivityRecord } from "../actions";
import { resolveActivityTypeIcon } from "../icon-map";
import { memberDisplayName } from "@/lib/members/format";
import { formatDateTime } from "@/lib/format/date";
import { ActivityFormPanel } from "./activity-form-panel";
import { DeleteActivityDialog } from "./delete-activity-dialog";

export interface ActivityQuickViewDialogProps {
  activity: ActivityRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  canDelete: boolean;
  /** `can(actor, "planning", "create")`, gated behind the `planning` feature
   * being entitled/accessible for this actor at all (issue #87) — shows the
   * "Create work order" action, which navigates to `/work-orders/new`
   * pre-scoped to this activity's own client/asset plus `?activityId=` for
   * traceability (`work_orders.source_activity_id`). Defaults to `false` so
   * every existing call site (before this prop was threaded through) keeps
   * hiding the action rather than crashing. */
  canCreateWorkOrder?: boolean;
  /** Called after a successful delete, so the caller (a table/panel holding
   * a list of activities) can drop this row without a full page reload. */
  onDeleted?: () => void;
}

/**
 * Read-only "slider popup" quick view for a single activity (`Dialog
 * size="panel"`) — the AC's explicit request for the Client detail page's
 * Activiteiten tab ("bij het klikken op de melding vanuit de klantkaart komt
 * er een slider popup"), also reused by the main `/activities` overview
 * table's own row click for the same "peek before committing to editing" UX.
 * A small, secondary, read-only view of an already-on-screen row — its own
 * "Edit" button opens `ActivityFormPanel` (also a slide-in panel, per
 * `docs/ARCHITECTURE.md` "Popup vs. full page") on top of this one rather
 * than navigating anywhere.
 */
export function ActivityQuickViewDialog({
  activity,
  open,
  onOpenChange,
  canEdit,
  canDelete,
  canCreateWorkOrder = false,
  onDeleted,
}: ActivityQuickViewDialogProps) {
  useEscapeToClose(open, onOpenChange);
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);

  const TypeIcon = resolveActivityTypeIcon(activity.activity_type?.icon);

  function handleCreateWorkOrder() {
    const params = new URLSearchParams();
    params.set("clientId", activity.client_id);
    if (activity.asset_id) params.set("assetId", activity.asset_id);
    params.set("activityId", activity.id);
    router.push(`/work-orders/new?${params.toString()}`);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} size="panel">
        <Dialog.Header>
          <Inline gap="sm" align="center">
            <TypeIcon aria-hidden="true" />
            <Heading level={3}>{activity.activity_type?.label ?? "Activity"}</Heading>
          </Inline>
        </Dialog.Header>
        <Dialog.Body>
          <Stack gap="md">
            <Inline gap="xs" align="center">
              <Badge color={activity.activity_status?.color} variant="muted">
                {activity.activity_status?.label ?? "—"}
              </Badge>
            </Inline>

            <DefinitionList
              items={[
                { label: "Client", value: activity.client?.name ?? "—" },
                { label: "Asset", value: activity.asset?.name ?? "—" },
                {
                  label: "Contact",
                  value: activity.contact_person?.name ?? activity.contact_name ?? "—",
                },
                { label: "Phone", value: activity.contact_phone ?? "—" },
                { label: "Email", value: activity.contact_email ?? "—" },
                { label: "Action holder", value: memberDisplayName(activity.action_holder) },
                { label: "Reported at", value: formatDateTime(activity.reported_at) },
                { label: "Reported by", value: memberDisplayName(activity.reporter) },
              ]}
            />

            <Stack gap="xs">
              <Text tone="muted">Description</Text>
              <Text>{activity.description}</Text>
            </Stack>
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canCreateWorkOrder && (
            <Button type="button" variant="outline" onClick={handleCreateWorkOrder}>
              Create work order
            </Button>
          )}
          {canDelete && (
            <Button type="button" variant="danger" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          )}
          {canEdit && (
            <Button type="button" variant="primary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </Dialog.Footer>
      </Dialog>

      {deleting && (
        <DeleteActivityDialog
          activity={activity}
          open
          onOpenChange={setDeleting}
          onDeleted={() => {
            onOpenChange(false);
            onDeleted?.();
          }}
        />
      )}

      {editing && (
        <ActivityFormPanel
          mode="edit"
          activity={activity}
          open
          onOpenChange={(next) => {
            if (!next) {
              setEditing(false);
              onOpenChange(false);
            }
          }}
        />
      )}
    </>
  );
}
