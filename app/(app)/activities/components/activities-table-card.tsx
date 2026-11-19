"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StatusText, WebDataTableCard, toneFromColor, type FilterOption, type WebColumn } from "@yourorg/ui/web-client";
import { formatDateTime } from "@/lib/format/date";
import { memberDisplayName } from "@/lib/members/format";
import type { ActivityRecord } from "../actions";
import { ACTIVITIES_PAGE_SIZE } from "./activities-query";
import { DeleteActivityDialog } from "./delete-activity-dialog";

const COMPLETION_SEGMENT = {
  label: "Completion",
  defaultValue: "open",
  options: [
    { value: "open", label: "Open" },
    { value: "completed", label: "Completed" },
    { value: "all", label: "All" },
  ] as const,
};

function descriptionSnippet(value: string): string {
  return value.length > 80 ? `${value.slice(0, 80)}…` : value;
}

/**
 * The Activities list table (list-page shell, issue #222): a
 * `WebDataTableCard` in server mode. `listActivities` (driven by the `q`,
 * `typeId`, `statusId`, `clientId`, `actionHolderId`, `seg`, `sort`, `dir` and
 * `page` URL params) returns the filtered page; this component only renders
 * it. The number opens the real `/activities/[id]` page (which also
 * owns editing); Delete asks for confirmation.
 */
export function ActivitiesTableCard({
  activities,
  total,
  unfilteredTotal,
  page,
  types,
  statuses,
  clients,
  actionHolders,
  canCreate,
  canDelete,
}: {
  activities: ActivityRecord[];
  total: number;
  unfilteredTotal?: number;
  page: number;
  types: FilterOption[];
  statuses: FilterOption[];
  clients: FilterOption[];
  actionHolders: FilterOption[];
  canCreate: boolean;
  canDelete: boolean;
}) {
  const [deleteTarget, setDeleteTarget] = useState<ActivityRecord | null>(null);

  const columns = useMemo<WebColumn<ActivityRecord>[]>(
    () => [
      { id: "number", header: "Number", primary: true, mono: true, sortable: true, render: (a) => a.activity_number },
      {
        id: "description",
        header: "Description",
        sortable: true,
        render: (a) => descriptionSnippet(a.description),
      },
      { id: "type", header: "Type", render: (a) => a.activity_type?.label ?? null },
      {
        id: "status",
        header: "Status",
        render: (a) =>
          a.activity_status ? (
            <StatusText display="badge" tone={toneFromColor(a.activity_status.color)}>{a.activity_status.label}</StatusText>
          ) : null,
      },
      { id: "client", header: "Client", render: (a) => (a.client ? <Link href={`/clients/${a.client.id}`}>{a.client.name}</Link> : null) },
      { id: "holder", header: "Action holder", render: (a) => (a.action_holder ? memberDisplayName(a.action_holder) : null) },
      { id: "reported", header: "Reported", sortable: true, render: (a) => formatDateTime(a.reported_at) },
    ],
    [],
  );

  const dropdowns = useMemo(
    () => [
      { id: "typeId", label: "Type", options: types },
      { id: "statusId", label: "Status", options: statuses },
      { id: "clientId", label: "Client", options: clients },
      { id: "actionHolderId", label: "Action holder", options: actionHolders },
    ],
    [types, statuses, clients, actionHolders],
  );

  return (
    <>
      <WebDataTableCard<ActivityRecord>
        rows={activities}
        getRowKey={(a) => a.id}
        columns={columns}
        noun="activities"
        dropdowns={dropdowns}
        segment={COMPLETION_SEGMENT}
        server={{ total, unfilteredTotal, page, pageSize: ACTIVITIES_PAGE_SIZE }}
        defaultSort={{ columnId: "reported", direction: "desc" }}
        rowHref={(a) => `/activities/${a.id}`}
        rowLabel={(a) => a.activity_number}
        rowActions={(a) => [
          { key: "open", label: "Open", href: `/activities/${a.id}` },
          ...(canDelete
            ? [
                { type: "separator" as const, key: "sep" },
                { key: "delete", label: "Delete…", danger: true, onSelect: () => setDeleteTarget(a) },
              ]
            : []),
        ]}
        emptyAction={
          canCreate ? (
            <Link href="/activities/new" className="web-rail-link">
              Create activity
            </Link>
          ) : null
        }
      />
      {canDelete && deleteTarget ? (
        <DeleteActivityDialog
          activity={deleteTarget}
          open
          onOpenChange={(next) => {
            if (!next) setDeleteTarget(null);
          }}
        />
      ) : null}
    </>
  );
}
