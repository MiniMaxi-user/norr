"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Input, Inline, Stack, Table, Text } from "@yourorg/ui";
import type { ActivityRecord } from "../actions";
import { resolveActivityTypeIcon } from "../icon-map";
import { memberDisplayName } from "@/lib/members/format";
import { formatDateTime } from "@/lib/format/date";
import { ActivityFormPanel } from "./activity-form-panel";
import { DeleteActivityDialog } from "./delete-activity-dialog";

export interface ActivitiesTableProps {
  activities: ActivityRecord[];
  canEdit: boolean;
  canDelete: boolean;
  /** Threaded into `ActivityFormPanel` — see that component's own doc
   * comment (issue #87). */
  canCreateWorkOrder?: boolean;
}

function descriptionSnippet(value: string): string {
  return value.length > 80 ? `${value.slice(0, 80)}…` : value;
}

/**
 * List view table for Activities — same client-side-search-over-current-page
 * shape as `WorkOrdersTable`/`AssetsTable`. There is no `/activities/[id]`
 * detail page — a row click and the row-level Edit action both open the same
 * `ActivityFormPanel` (`mode: "edit"`), which renders read-only for a caller
 * without `canEdit` (issue #90 — one screen for viewing and editing, no
 * separate read-only quick-view dialog).
 */
export function ActivitiesTable({ activities, canEdit, canDelete, canCreateWorkOrder }: ActivitiesTableProps) {
  const [query, setQuery] = useState("");
  const [editingActivity, setEditingActivity] = useState<ActivityRecord | null>(null);
  const [deletingActivity, setDeletingActivity] = useState<ActivityRecord | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter((activity) =>
      [
        activity.description,
        activity.activity_type?.label,
        activity.activity_status?.label,
        activity.client?.name,
        activity.asset?.name,
        memberDisplayName(activity.action_holder),
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(q)),
    );
  }, [activities, query]);

  const showActionsColumn = canEdit || canDelete;

  return (
    <>
      <Stack gap="md">
        <Input
          aria-label="Search activities on this page"
          placeholder="Search by description, type, client, action holder…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <Table stickyHeader maxHeight="65vh">
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>Type</Table.HeaderCell>
              <Table.HeaderCell align="center">Status</Table.HeaderCell>
              <Table.HeaderCell>Client</Table.HeaderCell>
              <Table.HeaderCell>Description</Table.HeaderCell>
              <Table.HeaderCell>Action holder</Table.HeaderCell>
              <Table.HeaderCell>Reported</Table.HeaderCell>
              {showActionsColumn && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {filtered.map((activity) => {
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
                  <Table.Cell>{activity.client?.name ?? "—"}</Table.Cell>
                  <Table.Cell>{descriptionSnippet(activity.description)}</Table.Cell>
                  <Table.Cell>{memberDisplayName(activity.action_holder)}</Table.Cell>
                  <Table.Cell>{formatDateTime(activity.reported_at)}</Table.Cell>
                  {showActionsColumn && (
                    <Table.Cell align="center">
                      <span className="ui-row-actions" onClick={(event) => event.stopPropagation()}>
                        {canEdit && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingActivity(activity)}
                          >
                            Edit
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => setDeletingActivity(activity)}
                          >
                            Delete
                          </Button>
                        )}
                      </span>
                    </Table.Cell>
                  )}
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>

        {filtered.length === 0 && <Text tone="muted">No activities match &ldquo;{query}&rdquo;.</Text>}
      </Stack>

      {deletingActivity && (
        <DeleteActivityDialog
          activity={deletingActivity}
          open
          onOpenChange={(next) => !next && setDeletingActivity(null)}
        />
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
    </>
  );
}
