"use client";

import { useState } from "react";
import { Badge, EmptyState, Inline, Stack, Table, Text } from "@yourorg/ui";
import { Bell } from "@yourorg/ui/icons";
import type { ActivityRecord } from "@/app/(app)/activities/actions";
import { resolveActivityTypeIcon } from "@/app/(app)/activities/icon-map";
import { ActivityFormPanel } from "@/app/(app)/activities/components/activity-form-panel";
import { CreateActivityButton } from "@/app/(app)/activities/components/create-activity-button";
import { memberDisplayName } from "@/lib/members/format";

export interface ActivitiesPanelProps {
  clientId: string;
  activities: ActivityRecord[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Threaded into `ActivityFormPanel`'s "Create work order" action (issue
   * #87) — see that component's own doc comment. */
  canCreateWorkOrder: boolean;
}

function formatDateTime(value: string): string {
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
 * "Activiteiten" tab on the Client detail page (issue #59, AC: "Activiteit
 * is vanaf de klant aan te maken" + "bij het klikken op de melding vanuit de
 * klantkaart komt er een slider popup") — per docs/ARCHITECTURE.md
 * "Relational detail pages", this is a sub-entity view scoped to the parent
 * client already on screen, not a link out to the standalone `/activities`
 * module list.
 *
 * "Create in context": the tab's own "New activity" button pre-scopes
 * `ActivityFormPanel` (a slide-in, per `docs/ARCHITECTURE.md` "Popup vs.
 * full page") to this client via `CreateActivityButton`'s `clientId` prop,
 * same shape as `CreateAssetButton`'s `clientId` prop on the Assets tab.
 *
 * Row click opens `ActivityFormPanel` in `mode: "edit"` directly (issue #90 —
 * one screen for viewing and editing, no separate read-only quick-view
 * dialog); it renders read-only when `canEdit` is `false`. This tab has no
 * row-level Delete button of its own — the panel's own `canDelete`-gated
 * Delete action (see that component's doc comment) is the only way to
 * delete an activity from here.
 */
export function ActivitiesPanel({
  clientId,
  activities,
  canCreate,
  canEdit,
  canDelete,
  canCreateWorkOrder,
}: ActivitiesPanelProps) {
  const [editingActivity, setEditingActivity] = useState<ActivityRecord | null>(null);

  return (
    <Stack gap="md">
      {canCreate && (
        <Inline justify="end">
          <CreateActivityButton clientId={clientId} label="New activity" size="sm" />
        </Inline>
      )}

      {activities.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          heading="No activities yet"
          text="Log a call, storing, onderhoud, afspraak, or e-mail opvolging for this client."
          action={canCreate ? <CreateActivityButton clientId={clientId} label="New activity" /> : undefined}
        />
      ) : (
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>Type</Table.HeaderCell>
              <Table.HeaderCell align="center">Status</Table.HeaderCell>
              <Table.HeaderCell>Description</Table.HeaderCell>
              <Table.HeaderCell>Action holder</Table.HeaderCell>
              <Table.HeaderCell>Reported</Table.HeaderCell>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {activities.map((activity) => {
              const TypeIcon = resolveActivityTypeIcon(activity.activity_type?.icon);
              return (
                <Table.Row key={activity.id} onClick={() => setEditingActivity(activity)}>
                  <Table.Cell>
                    <Inline gap="xs" align="center">
                      <TypeIcon aria-hidden="true" />
                      <Text>{activity.activity_type?.label ?? "—"}</Text>
                    </Inline>
                  </Table.Cell>
                  <Table.Cell align="center">
                    <Badge color={activity.activity_status?.color} variant="muted">
                      {activity.activity_status?.label ?? "—"}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>{activity.description.length > 60 ? `${activity.description.slice(0, 60)}…` : activity.description}</Table.Cell>
                  <Table.Cell>{memberDisplayName(activity.action_holder)}</Table.Cell>
                  <Table.Cell>{formatDateTime(activity.reported_at)}</Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      )}

      {editingActivity && (
        <ActivityFormPanel
          mode="edit"
          activity={editingActivity}
          open
          onOpenChange={(next) => !next && setEditingActivity(null)}
          canEdit={canEdit}
          canDelete={canDelete}
          canCreateWorkOrder={canCreateWorkOrder}
          onDeleted={() => setEditingActivity(null)}
        />
      )}
    </Stack>
  );
}
