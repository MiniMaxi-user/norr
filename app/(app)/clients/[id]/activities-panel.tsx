"use client";

import { useMemo } from "react";
import { StatusText, WebDataTableCard, toneFromColor, type WebColumn } from "@yourorg/ui/web-client";
import type { ActivityRecord } from "@/app/(app)/activities/actions";
import { CreateActivityButton } from "@/app/(app)/activities/components/create-activity-button";
import { formatDateTimeWeb } from "@/lib/format/web";
import { memberDisplayName } from "@/lib/members/format";

export interface ActivitiesPanelProps {
  /** Client tab: "+ Activity" pre-scopes the create page to this client. */
  clientId?: string;
  /** Asset page: pre-scopes it to this asset instead (client resolved
   * server-side). */
  assetId?: string;
  /** URL param namespace (default "activities"). */
  urlPrefix?: string;
  activities: ActivityRecord[];
  canCreate: boolean;
}

const isDone = (activity: ActivityRecord) => activity.activity_status?.value === "completed";

/**
 * Activities tab (issue #59; design-system table pattern, issue #222) — one
 * card with a FilterBar: Type / Status / Action holder dropdowns and
 * Open · Done · All (default Open; Done = status "completed"). "+ Activity"
 * opens the create page pre-scoped to this client (`/activities/new?
 * clientId=…`); a row opens the real `/activities/[id]` page, which owns edit
 * and delete.
 */
export function ActivitiesPanel({ clientId, assetId, urlPrefix = "activities", activities, canCreate }: ActivitiesPanelProps) {
  const columns = useMemo<WebColumn<ActivityRecord>[]>(
    () => [
      {
        id: "type",
        header: "Type",
        primary: true,
        sortValue: (activity) => activity.activity_type?.label ?? "",
        render: (activity) => activity.activity_type?.label ?? "—",
      },
      {
        id: "status",
        header: "Status",
        sortValue: (activity) => activity.activity_status?.label ?? "",
        render: (activity) =>
          activity.activity_status ? (
            <StatusText tone={toneFromColor(activity.activity_status.color)}>{activity.activity_status.label}</StatusText>
          ) : (
            "—"
          ),
      },
      {
        id: "description",
        header: "Description",
        render: (activity) =>
          activity.description.length > 60 ? `${activity.description.slice(0, 60)}…` : activity.description,
      },
      {
        id: "holder",
        header: "Action holder",
        sortValue: (activity) => (activity.action_holder ? memberDisplayName(activity.action_holder) : ""),
        render: (activity) => (activity.action_holder ? memberDisplayName(activity.action_holder) : "—"),
      },
      {
        id: "reported",
        header: "Reported",
        sortValue: (activity) => activity.reported_at,
        render: (activity) => formatDateTimeWeb(activity.reported_at),
      },
    ],
    [],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "type",
        label: "Type",
        getOptions: (activity: ActivityRecord) =>
          activity.activity_type ? [{ value: activity.activity_type.value, label: activity.activity_type.label }] : [],
      },
      {
        id: "status",
        label: "Status",
        getOptions: (activity: ActivityRecord) =>
          activity.activity_status
            ? [{ value: activity.activity_status.value, label: activity.activity_status.label }]
            : [],
      },
      {
        id: "holder",
        label: "Action holder",
        getOptions: (activity: ActivityRecord) =>
          activity.action_holder
            ? [{ value: activity.action_holder.id, label: memberDisplayName(activity.action_holder) }]
            : [],
      },
    ],
    [],
  );

  const segment = useMemo(
    () => ({
      label: "Show activities",
      defaultValue: "open",
      options: [
        { value: "open", label: "Open", match: (activity: ActivityRecord) => !isDone(activity) },
        { value: "done", label: "Done", match: isDone },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  return (
    <WebDataTableCard
      title="Activities"
      meta={`${activities.length} · ${activities.filter((activity) => !isDone(activity)).length} open`}
      rows={activities}
      getRowKey={(activity) => activity.id}
      columns={columns}
      searchText={(activity) =>
        [
          activity.activity_type?.label,
          activity.activity_status?.label,
          activity.description,
          activity.action_holder ? memberDisplayName(activity.action_holder) : "",
        ]
          .filter(Boolean)
          .join(" ")
      }
      noun="activities"
      dropdowns={dropdowns}
      segment={segment}
      urlPrefix={urlPrefix}
      defaultSort={{ columnId: "reported", direction: "desc" }}
      rowHref={(activity) => `/activities/${activity.id}`}
      rowLabel={(activity) => activity.activity_type?.label ?? "activity"}
      add={canCreate ? <CreateActivityButton clientId={clientId} assetId={assetId} label="+ Activity" filterBar /> : undefined}
      emptyAction={canCreate ? "Use + Activity to log a call, breakdown or appointment." : undefined}
    />
  );
}
