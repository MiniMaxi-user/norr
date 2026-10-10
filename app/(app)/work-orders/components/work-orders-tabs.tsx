"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@yourorg/ui";
import type { WorkOrdersTab } from "../tabs";

const TAB_LABELS: Record<WorkOrdersTab, string> = {
  review: "Review",
  orders: "Orders",
  completed: "Completed",
};

/**
 * The Work Orders overview's Review / Orders / Completed tabs (issue #207).
 * URL-driven (`?tab=`) rather than local state, so the server-rendered list
 * below is re-fetched with the matching status filter — only the active
 * tab's panel is ever rendered, its content passed in as `children`.
 */
export function WorkOrdersTabs({
  tab,
  counts,
  children,
}: {
  tab: WorkOrdersTab;
  counts: Partial<Record<WorkOrdersTab, number>>;
  children: ReactNode;
}) {
  const router = useRouter();

  function select(next: string) {
    if (next === tab) return;
    router.push(`/work-orders?tab=${next}`);
  }

  return (
    <Tabs value={tab} onValueChange={select}>
      <TabsList aria-label="Work order status">
        {(Object.keys(TAB_LABELS) as WorkOrdersTab[]).map((value) => (
          <TabsTab key={value} value={value}>
            {TAB_LABELS[value]}
            {counts[value] !== undefined ? ` (${counts[value]})` : ""}
          </TabsTab>
        ))}
      </TabsList>
      <TabsPanel value={tab}>{children}</TabsPanel>
    </Tabs>
  );
}
