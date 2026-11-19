"use client";

import { useMemo } from "react";
import { WebBadge } from "@yourorg/ui/web";
import { WebDataTableCard, type WebColumn } from "@yourorg/ui/web-client";
import { formatDateTimeWeb, formatNumberWeb } from "@/lib/format/web";
import type { WorkOrderVolumeReadingRecord } from "../volume-actions";

export interface WorkOrderVolumesPanelProps {
  readings: WorkOrderVolumeReadingRecord[];
}

const REASON_TEXT: Record<string, string> = {
  below_previous: "Lower than an earlier reading",
  above_next: "Higher than a later reading",
};

/**
 * Volumes tab (issues #221/#225): meter readings registered on this work
 * order. Readings the field app accepted although inconsistent with a
 * neighbouring reading carry a "Needs review" badge with the reason and the
 * neighbouring values, so the office can judge them while the work order is
 * in To review. Read-only; clearing the flag is out of scope.
 */
export function WorkOrderVolumesPanel({ readings }: WorkOrderVolumesPanelProps) {
  const columns = useMemo<WebColumn<WorkOrderVolumeReadingRecord>[]>(
    () => [
      {
        id: "counter",
        header: "Counter",
        sortValue: (row) => row.counterLabel,
        render: (row) => (row.unitLabel ? `${row.counterLabel} (${row.unitLabel})` : row.counterLabel),
      },
      {
        id: "value",
        header: "Value",
        align: "end",
        sortValue: (row) => row.value,
        render: (row) => formatNumberWeb(row.value),
      },
      { id: "readAt", header: "Read at", sortValue: (row) => row.readAt, render: (row) => formatDateTimeWeb(row.readAt) },
      {
        id: "by",
        header: "Entered by",
        sortValue: (row) => row.enteredByName ?? "",
        render: (row) => row.enteredByName ?? "—",
      },
      { id: "notes", header: "Notes", render: (row) => row.notes ?? "—" },
      {
        id: "review",
        header: "Review",
        render: (row) => {
          if (!row.needsReview) return "—";
          const neighbours = [
            row.previousValue !== null ? `previous ${formatNumberWeb(row.previousValue)}` : null,
            row.nextValue !== null ? `next ${formatNumberWeb(row.nextValue)}` : null,
          ].filter(Boolean);
          return (
            <>
              <WebBadge variant="warning">Needs review</WebBadge>{" "}
              {(row.reviewReason && REASON_TEXT[row.reviewReason]) ?? ""}
              {neighbours.length > 0 ? ` (${neighbours.join(", ")})` : ""}
            </>
          );
        },
      },
    ],
    [],
  );

  const segment = useMemo(
    () => ({
      label: "Show readings",
      defaultValue: "all",
      options: [
        { value: "review", label: "Needs review", match: (row: WorkOrderVolumeReadingRecord) => row.needsReview },
        { value: "ok", label: "Accepted", match: (row: WorkOrderVolumeReadingRecord) => !row.needsReview },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "counter",
        label: "Counter",
        getOptions: (row: WorkOrderVolumeReadingRecord) => [{ value: row.counterLabel, label: row.counterLabel }],
      },
    ],
    [],
  );

  const flagged = readings.filter((reading) => reading.needsReview).length;

  return (
    <div className="web-tab-stack">
      <WebDataTableCard
        title="Volumes"
        meta={flagged > 0 ? `${readings.length} · ${flagged} need review` : String(readings.length)}
        rows={readings}
        getRowKey={(row) => row.id}
        columns={columns}
        searchText={(row) => `${row.counterLabel} ${row.enteredByName ?? ""} ${row.notes ?? ""}`}
        noun="readings"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="volumes"
        defaultSort={{ columnId: "readAt", direction: "asc" }}
        isAttention={(row) => row.needsReview}
        rowLabel={(row) => `${row.counterLabel} reading of ${formatNumberWeb(row.value)}`}
      />
    </div>
  );
}
