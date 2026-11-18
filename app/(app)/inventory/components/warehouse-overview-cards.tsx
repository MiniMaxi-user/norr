"use client";

import { WebCardStack } from "@yourorg/ui/web";
import { KeyValueCard, type EditModeApi, type KvField } from "@yourorg/ui/web-client";
import { formatDateWeb } from "@/lib/format/web";
import type { WarehouseRecord } from "../actions";

/** Flat, string-shaped draft of the one editable field of a warehouse. */
export type WarehouseDraft = { name: string };

export function draftFromWarehouse(warehouse: WarehouseRecord): WarehouseDraft {
  return { name: warehouse.name };
}

/**
 * The Overview tab's card (design system, issue #222): ONE "Details" card —
 * Name (the only editable field, through the page header's Edit button),
 * Engineer (the warehouse belongs to one engineer; derived) and when it was
 * created. Stock figures live in the right rail, not here.
 */
export function WarehouseOverviewCards({
  edit,
  warehouse,
}: {
  edit: EditModeApi<WarehouseDraft>;
  warehouse: WarehouseRecord;
}) {
  const fields: KvField[] = [
    { key: "name", label: "Name", read: edit.record.name, maxLength: 200 },
    {
      key: "engineer",
      label: "Engineer",
      kind: "derived",
      read: warehouse.engineer?.full_name || warehouse.engineer?.email || "Unassigned",
      note: "One warehouse per engineer",
    },
    { key: "created", label: "Created", kind: "derived", read: formatDateWeb(warehouse.created_at) },
  ];

  return (
    <WebCardStack>
      <KeyValueCard title="Details" fields={fields} edit={edit} />
    </WebCardStack>
  );
}
