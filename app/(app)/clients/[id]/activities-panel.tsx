"use client";

import { useRouter } from "next/navigation";
import { Badge, EmptyState, Inline, SectionHeader, Stack, Table, Text } from "@yourorg/ui";
import { Bell } from "@yourorg/ui/icons";
import type { ActivityRecord } from "@/app/(app)/activities/actions";
import { resolveActivityTypeIcon } from "@/app/(app)/activities/icon-map";
import { CreateActivityButton } from "@/app/(app)/activities/components/create-activity-button";
import { memberDisplayName } from "@/lib/members/format";

export interface ActivitiesPanelProps {
  clientId: string;
  activities: ActivityRecord[];
  canCreate: boolean;
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
 * is vanaf de klant aan te maken") — per docs/ARCHITECTURE.md "Relational
 * detail pages", this is a sub-entity view scoped to the parent client
 * already on screen, not a link out to the standalone `/activities` module
 * list.
 *
 * "Create in context": the tab's own "+ Activity" button (in a
 * `SectionHeader`, same small-primary tab-panel "Add X" convention as
 * Sites/Contacts/Assets — issue #113, `docs/ARCHITECTURE.md`'s "Row and
 * tab-panel conventions") pre-scopes `CreateActivityButton`'s target
 * `/activities/new?clientId=...` to this client.
 *
 * Issue #118 replaced the row click's old `ActivityFormPanel` (a slide-in
 * `Dialog`, deleted) with a plain navigation to the real `/activities/[id]`
 * detail page — that page renders read-only for a caller without edit
 * rights and owns its own Delete action, so this tab no longer needs
 * `canEdit`/`canDelete`/`canCreateWorkOrder` props of its own.
 */
export function ActivitiesPanel({ clientId, activities, canCreate }: ActivitiesPanelProps) {
  const router = useRouter();

  return (
    <Stack gap="md">
      <SectionHeader
        icon={Bell}
        title="Activiteiten"
        actions={canCreate && <CreateActivityButton clientId={clientId} label="+ Activity" size="sm" />}
      />

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
                <Table.Row key={activity.id} onClick={() => router.push(`/activities/${activity.id}`)}>
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
    </Stack>
  );
}
