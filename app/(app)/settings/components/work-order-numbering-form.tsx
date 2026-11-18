"use client";

import { updateWorkOrderNumberingSettings } from "../work-order-numbering/actions";
import { SettingsNumberingForm, type NumberingSettings } from "./settings-numbering-form";

export interface WorkOrderNumberingFormProps {
  initial: NumberingSettings;
  /** `can(actor, "work_order_numbering", "update")` - without it there is no Edit button. */
  canWrite: boolean;
}

/** Work order numbering settings (issue #218) — see `SettingsNumberingForm`. */
export function WorkOrderNumberingForm({ initial, canWrite }: WorkOrderNumberingFormProps) {
  return (
    <SettingsNumberingForm
      navKey="work_order_numbering"
      noun="work order"
      initial={initial}
      canWrite={canWrite}
      save={updateWorkOrderNumberingSettings}
    />
  );
}
