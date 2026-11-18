"use client";

import { useMemo } from "react";
import { WebHint } from "@yourorg/ui/web";
import { KeyValueCard, type EditSchema, type KvEditBinder, type SaveResult } from "@yourorg/ui/web-client";
import type { ActionResult } from "@/lib/actions/result";
import { firstFieldErrors, SettingsFormPage, useSettingsEdit } from "./settings-form-page";

export interface NumberingSettings {
  prefix: string;
  nextNumber: number;
}

type NumberingDraft = {
  prefix: string;
  nextNumber: string;
};

const MAX_NUMBER = 2_000_000_000;

export interface SettingsNumberingFormProps {
  /** Nav key of the section (`contract_numbering` / `work_order_numbering`). */
  navKey: string;
  /** Singular noun for the preview and hints ("contract", "work order"). */
  noun: string;
  initial: NumberingSettings;
  /** `can(actor, "<module>_numbering", "update")`: without it there is no Edit button. */
  canWrite: boolean;
  /** The existing update action of the module. */
  save: (input: unknown) => Promise<ActionResult<{ settings: NumberingSettings }>>;
}

/**
 * Prefix + next number of a per-tenant numbering sequence (issues #216/#218) on
 * the web design system: one "Numbering" card (prefix, next number, and the
 * derived preview of the next assigned number) read like a record's Overview,
 * edited from the header's single Edit button. Mirrors the zod schema in
 * `../<module>-numbering/schema.ts`; the server (and the DB: the number can only
 * be raised) stays the authority.
 */
export function SettingsNumberingForm({ navKey, noun, initial, canWrite, save }: SettingsNumberingFormProps) {
  const record = useMemo<NumberingDraft>(
    () => ({ prefix: initial.prefix, nextNumber: String(initial.nextNumber) }),
    [initial.prefix, initial.nextNumber],
  );

  const schema = useMemo<EditSchema<NumberingDraft>>(
    () => ({
      prefix: {
        label: "Prefix",
        required: true,
        validate: (value) => {
          const trimmed = value.trim().toUpperCase();
          if (!trimmed) return "Enter a prefix of 1 to 10 characters";
          if (!/^[A-Z0-9._/-]{1,10}$/.test(trimmed)) {
            return "Use 1 to 10 characters: letters A-Z, digits 0-9 and - _ . / only";
          }
          return null;
        },
      },
      nextNumber: {
        label: "Next number",
        required: true,
        validate: (value) => {
          const text = value.trim();
          if (!text) return "Enter the next number";
          if (!/^\d+$/.test(text)) return "Next number must be a whole number";
          const parsed = Number(text);
          if (parsed < 1) return "Next number must be at least 1";
          if (parsed > MAX_NUMBER) return "Next number is too large";
          if (parsed < initial.nextNumber) {
            return `Next number can only be raised: enter ${initial.nextNumber} or higher`;
          }
          return null;
        },
      },
    }),
    [initial.nextNumber],
  );

  const edit = useSettingsEdit<NumberingDraft>({
    record,
    schema,
    canEdit: canWrite,
    idPrefix: `${navKey}`,
    firstFieldKey: "prefix",
    onSave: async (draft): Promise<SaveResult<NumberingDraft>> => {
      const result = await save({
        prefix: draft.prefix.trim().toUpperCase(),
        nextNumber: Number(draft.nextNumber),
      });
      if (result.error || !result.data) {
        return {
          ok: false,
          error: result.error ?? "Could not save the numbering settings",
          fieldErrors: firstFieldErrors<"prefix" | "nextNumber">(result.fieldErrors),
        };
      }
      return { ok: true };
    },
  });

  // The prefix is always stored in capitals: type it that way.
  const binder = useMemo<KvEditBinder>(
    () => ({
      get isEditing() {
        return edit.isEditing;
      },
      getField: (key: string) => {
        const binding = edit.getField(key as keyof NumberingDraft & string);
        if (key === "prefix") {
          return { ...binding, onChange: (value) => binding.onChange(String(value).toUpperCase()) };
        }
        return binding;
      },
      countsFor: (keys) => edit.countsFor(keys),
    }),
    [edit],
  );

  const preview = `${edit.draft.prefix.trim().toUpperCase()}${edit.draft.nextNumber.trim()}`;

  return (
    <SettingsFormPage
      navKey={navKey}
      edit={edit}
      readOnlyNote="Only an owner or administratie member can change these settings."
    >
      <KeyValueCard
        title="Numbering"
        edit={binder}
        fields={[
          { key: "prefix", label: "Prefix", mono: true, read: edit.record.prefix, maxLength: 10 },
          { key: "nextNumber", label: "Next number", kind: "number", mono: true, read: edit.record.nextNumber, min: String(initial.nextNumber), step: "1" },
          {
            key: "preview",
            label: `Next ${noun} number`,
            kind: "derived",
            mono: true,
            read: preview,
            note: "Assigned to the next new record",
          },
        ]}
      />
      <WebHint>
        Every {noun} gets a unique number automatically: the prefix followed by a running number. Changing the prefix
        does not renumber existing {noun}s, and the next number can only be raised, never lowered.
      </WebHint>
    </SettingsFormPage>
  );
}
