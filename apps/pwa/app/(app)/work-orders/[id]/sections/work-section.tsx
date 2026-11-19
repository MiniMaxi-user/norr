"use client";

import { Textarea } from "@yourorg/ui";
import { PwaCardPad, PwaCardText, PwaStack, WebCard } from "@yourorg/ui/web";
import type { WorkOrderDetail } from "@/lib/work-orders/types";
import type { WorkOrderVolumesResponse } from "@/lib/asset-volumes/types";
import type { LocalVolumeReading } from "@/lib/offline/db";
import { VolumesBlock } from "./volumes-block";

/**
 * The "WORK" tab (`?section=work`, product feedback, 2026-09-14 — split out
 * of the original "Work" tab, which is now "HOME" and keeps Location/Asset/
 * Contract, see `home-section.tsx`) — Description is the fixed problem
 * statement from the office (read-only, always), Solution is the free-text
 * resolution the engineer writes (editable, synced to `work_orders.solution`
 * on Finish — the work-order-level equivalent of `activities.solution` on
 * the desktop webapp). State is owned by `work-order-detail.tsx` so it
 * survives switching tabs.
 */
export function WorkSection({
  workOrderId,
  currentUserId,
  workOrder,
  solution,
  onSolutionChange,
  volumes,
  localVolumeReadings,
  onVolumesChanged,
  onLocalVolumesChanged,
}: {
  workOrderId: string;
  currentUserId: string;
  workOrder: WorkOrderDetail;
  solution: string;
  onSolutionChange: (value: string) => void;
  volumes: WorkOrderVolumesResponse | null;
  localVolumeReadings: LocalVolumeReading[];
  onVolumesChanged: () => Promise<void>;
  onLocalVolumesChanged: () => Promise<void>;
}) {
  const { description } = workOrder;

  return (
    <PwaStack>
      <WebCard size="touch" title="Description">
        <PwaCardText empty={!description}>{description || "No description added."}</PwaCardText>
      </WebCard>

      <WebCard size="touch" title="Solution">
        <PwaCardPad>
          <Textarea
            aria-label="Solution"
            placeholder="What did you do to resolve this?"
            value={solution}
            onChange={(event) => onSolutionChange(event.target.value)}
            rows={4}
          />
        </PwaCardPad>
      </WebCard>

      <VolumesBlock
        workOrderId={workOrderId}
        currentUserId={currentUserId}
        data={volumes}
        localReadings={localVolumeReadings}
        onChanged={onVolumesChanged}
        onLocalChanged={onLocalVolumesChanged}
      />
    </PwaStack>
  );
}
