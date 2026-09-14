"use client";

import { Card, Heading, Stack, Text, Textarea } from "@yourorg/ui";
import type { WorkOrderDetail } from "@/lib/work-orders/types";

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
  workOrder,
  solution,
  onSolutionChange,
}: {
  workOrder: WorkOrderDetail;
  solution: string;
  onSolutionChange: (value: string) => void;
}) {
  const { description } = workOrder;

  return (
    <Stack gap="md">
      <Card>
        <Stack gap="sm">
          <Heading level={3}>Description</Heading>
          <Text>{description || "No description added."}</Text>
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <Heading level={3}>Solution</Heading>
          <Textarea
            aria-label="Solution"
            placeholder="What did you do to resolve this?"
            value={solution}
            onChange={(event) => onSolutionChange(event.target.value)}
            rows={4}
          />
        </Stack>
      </Card>
    </Stack>
  );
}
