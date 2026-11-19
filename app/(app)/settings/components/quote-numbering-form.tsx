"use client";

import { updateQuoteNumberingSettings } from "../quote-numbering/actions";
import { SettingsNumberingForm, type NumberingSettings } from "./settings-numbering-form";

export interface QuoteNumberingFormProps {
  initial: NumberingSettings;
  /** `can(actor, "quote_numbering", "update")` - without it there is no Edit button. */
  canWrite: boolean;
}

/** Quote numbering settings (issue #228) — see `SettingsNumberingForm`. */
export function QuoteNumberingForm({ initial, canWrite }: QuoteNumberingFormProps) {
  return (
    <SettingsNumberingForm
      navKey="quote_numbering"
      noun="quote"
      initial={initial}
      canWrite={canWrite}
      save={updateQuoteNumberingSettings}
    />
  );
}
