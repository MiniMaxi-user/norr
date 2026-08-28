"use client";

import { useState } from "react";
import { Badge, EmptyState, Inline, Stack, Table, Text } from "@yourorg/ui";
import { Bell } from "@yourorg/ui/icons";
import type { ActivityRecord } from "@/app/(app)/activities/actions";
import { resolveActivityTypeIcon } from "@/app/(app)/activities/icon-map";
import { ActivityQuickViewDialog } from "@/app/(app)/activities/components/activity-quick-view-dialog";
import { CreateActivityButton } from "@/app/(app)/activities/components/create-activity-button";
import { memberDisplayName } from "@/lib/members/format";

export interface ActivitiesPanelProps {
  clientId: string;
  activities: ActivityRecord[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
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
 * Row click deliberately opens the read-only `ActivityQuickViewDialog`
 * slide-in instead of navigating away from the client page immediately — the
 * AC's explicit "slider popup" request for this exact entry point — with an
 * "Edit" button inside that dialog that opens `ActivityFormPanel` on top of
 * it.
 */
export function ActivitiesPanel({ clientId, activities, canCreate, canEdit, canDelete }: ActivitiesPanelProps) {
  const [viewingActivity, setViewingActivity] = useState<ActivityRecord | null>(null);

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
                <Table.Row key={activity.id} onClick={() => setViewingActivity(activity)}>
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

      {viewingActivity && (
        <ActivityQuickViewDialog
          activity={viewingActivity}
          open
          onOpenChange={(next) => !next && setViewingActivity(null)}
          canEdit={canEdit}
          canDelete={canDelete}
          onDeleted={() => setViewingActivity(null)}
        />
      )}
    </Stack>
  );
}
