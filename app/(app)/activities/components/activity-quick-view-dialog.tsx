"use client";

import { useState } from "react";
import { Badge, Button, DefinitionList, Dialog, Heading, Inline, Stack, Text } from "@yourorg/ui";
import type { ActivityRecord } from "../actions";
import { resolveActivityTypeIcon } from "../icon-map";
import { memberDisplayName } from "@/lib/members/format";
import { useEscapeToClose } from "@/app/(app)/clients/use-escape-to-close";
import { ActivityFormPanel } from "./activity-form-panel";
import { DeleteActivityDialog } from "./delete-activity-dialog";

export interface ActivityQuickViewDialogProps {
  activity: ActivityRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  canDelete: boolean;
  /** Called after a successful delete, so the caller (a table/panel holding
   * a list of activities) can drop this row without a full page reload. */
  onDeleted?: () => void;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
  onDeleted,
}: ActivityQuickViewDialogProps) {
  useEscapeToClose(open, onOpenChange);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);

  const TypeIcon = resolveActivityTypeIcon(activity.activity_type?.icon);

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
