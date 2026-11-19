"use client";

import { updateActivityNumberingSettings } from "../activity-numbering/actions";
import { SettingsNumberingForm, type NumberingSettings } from "./settings-numbering-form";

export interface ActivityNumberingFormProps {
  initial: NumberingSettings;
  /** `can(actor, "activity_numbering", "update")` - without it there is no Edit button. */
  canWrite: boolean;
}

/** Activity numbering settings (issue #228) — see `SettingsNumberingForm`. */
export function ActivityNumberingForm({ initial, canWrite }: ActivityNumberingFormProps) {
  return (
    <SettingsNumberingForm
      navKey="activity_numbering"
      noun="activity"
      initial={initial}
      canWrite={canWrite}
      save={updateActivityNumberingSettings}
    />
  );
}
