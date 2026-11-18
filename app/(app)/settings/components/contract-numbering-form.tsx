"use client";

import { updateContractNumberingSettings } from "../contract-numbering/actions";
import { SettingsNumberingForm, type NumberingSettings } from "./settings-numbering-form";

export interface ContractNumberingFormProps {
  initial: NumberingSettings;
  /** `can(actor, "contract_numbering", "update")` - without it there is no Edit button. */
  canWrite: boolean;
}

/** Contract numbering settings (issue #216) — see `SettingsNumberingForm`. */
export function ContractNumberingForm({ initial, canWrite }: ContractNumberingFormProps) {
  return (
    <SettingsNumberingForm
      navKey="contract_numbering"
      noun="contract"
      initial={initial}
      canWrite={canWrite}
      save={updateContractNumberingSettings}
    />
  );
}
