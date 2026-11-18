"use client";

import { useMemo } from "react";
import { WebCardPair, WebHint } from "@yourorg/ui/web";
import { KeyValueCard, type EditSchema, type KvField, type SaveResult } from "@yourorg/ui/web-client";
import type { RoundingDirection } from "@yourorg/time-rounding";
import {
  updateOrganizationTimeRoundingSettings,
  type OrganizationTimeRoundingSettings,
} from "../organization-time-rounding-actions";
import { SettingsFormPage, useSettingsEdit } from "./settings-form-page";

export interface OrganizationTimeRoundingFormProps {
  initial: OrganizationTimeRoundingSettings;
  /** `can(actor, "settings", "update")` — owner-only, matching this action's
   * own gate (see `../organization-time-rounding-actions.ts`'s header
   * comment). Without it the page has no Edit button, only the read view. */
  canWrite: boolean;
}

/** `""` = not configured (no minimum / no rounding). */
type TimeRoundingDraft = {
  travelMinimumMinutes: string;
  travelRoundingMinutes: string;
  travelDirection: string;
  workMinimumMinutes: string;
  workRoundingMinutes: string;
  workDirection: string;
};

function ruleToDraft(rule: OrganizationTimeRoundingSettings["travel"]) {
  return {
    minimum: rule.minimumMinutes === null ? "" : String(rule.minimumMinutes),
    rounding: rule.roundingMinutes === null ? "" : String(rule.roundingMinutes),
    direction: rule.direction as string,
  };
}

const DIRECTION_OPTIONS = [
  { value: "up", label: "Round up" },
  { value: "down", label: "Round down" },
];

function validateMinimum(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^-?\d+$/.test(text)) return "Minimum duration must be a whole number of minutes";
  if (Number(text) < 0) return "Minimum duration cannot be negative: enter 0 or more";
  return null;
}

function validateRounding(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^-?\d+$/.test(text)) return "Rounding interval must be a whole number of minutes";
  if (Number(text) <= 0) return "Rounding interval must be greater than zero";
  return null;
}

function validateDirection(value: string): string | null {
  return value === "up" || value === "down" ? null : "Choose round up or round down";
}

function minutesText(value: string) {
  return value.trim() ? `${value.trim()} min` : "";
}

function directionText(value: string) {
  return DIRECTION_OPTIONS.find((option) => option.value === value)?.label ?? "";
}

/**
 * Org-level travel/work minimum-duration + rounding settings (issue #198) on
 * the web design system (issue #222): a pair of identically shaped cards
 * (Travel time, Work time) with minimum duration (a floor, applied first),
 * rounding interval (applied second) and direction. One Edit button in the
 * header; a blank minimum / interval clears that rule. Mirrors the zod schema
 * in `../organization-time-rounding-actions.ts` (the server stays the
 * authority).
 */
export function OrganizationTimeRoundingForm({ initial, canWrite }: OrganizationTimeRoundingFormProps) {
  const record = useMemo<TimeRoundingDraft>(() => {
    const travel = ruleToDraft(initial.travel);
    const work = ruleToDraft(initial.work);
    return {
      travelMinimumMinutes: travel.minimum,
      travelRoundingMinutes: travel.rounding,
      travelDirection: travel.direction,
      workMinimumMinutes: work.minimum,
      workRoundingMinutes: work.rounding,
      workDirection: work.direction,
    };
  }, [initial]);

  const schema = useMemo<EditSchema<TimeRoundingDraft>>(
    () => ({
      travelMinimumMinutes: { label: "Travel minimum duration", validate: validateMinimum, format: minutesText },
      travelRoundingMinutes: { label: "Travel rounding interval", validate: validateRounding, format: minutesText },
      travelDirection: { label: "Travel direction", validate: validateDirection, format: directionText },
      workMinimumMinutes: { label: "Work minimum duration", validate: validateMinimum, format: minutesText },
      workRoundingMinutes: { label: "Work rounding interval", validate: validateRounding, format: minutesText },
      workDirection: { label: "Work direction", validate: validateDirection, format: directionText },
    }),
    [],
  );

  const edit = useSettingsEdit<TimeRoundingDraft>({
    record,
    schema,
    canEdit: canWrite,
    idPrefix: "time-rounding",
    firstFieldKey: "travelMinimumMinutes",
    onSave: async (draft): Promise<SaveResult<TimeRoundingDraft>> => {
      const parseMinutes = (value: string): number | null => (value.trim() === "" ? null : Number(value.trim()));
      const result = await updateOrganizationTimeRoundingSettings({
        travel: {
          minimumMinutes: parseMinutes(draft.travelMinimumMinutes),
          roundingMinutes: parseMinutes(draft.travelRoundingMinutes),
          direction: draft.travelDirection as RoundingDirection,
        },
        work: {
          minimumMinutes: parseMinutes(draft.workMinimumMinutes),
          roundingMinutes: parseMinutes(draft.workRoundingMinutes),
          direction: draft.workDirection as RoundingDirection,
        },
      });
      if (result.error || !result.data) {
        // The action's `fieldErrors` only bin by the top-level path (`travel` /
        // `work`), so a nested issue lands on the first field of that rule.
        const fieldErrors: Partial<Record<keyof TimeRoundingDraft & string, string>> = {};
        const travelMessage = result.fieldErrors?.travel?.[0];
        const workMessage = result.fieldErrors?.work?.[0];
        if (travelMessage) fieldErrors.travelMinimumMinutes = travelMessage;
        if (workMessage) fieldErrors.workMinimumMinutes = workMessage;
        return { ok: false, error: result.error ?? "Could not save time rounding settings", fieldErrors };
      }
      return { ok: true };
    },
  });

  function fieldsFor(prefix: "travel" | "work"): KvField[] {
    const minimum = `${prefix}MinimumMinutes` as const;
    const rounding = `${prefix}RoundingMinutes` as const;
    const direction = `${prefix}Direction` as const;
    return [
      {
        key: minimum,
        label: "Minimum duration (minutes)",
        kind: "number",
        read: minutesText(edit.record[minimum]) || "No minimum",
        placeholder: "No minimum",
        min: "0",
        step: "1",
      },
      {
        key: rounding,
        label: "Rounding interval (minutes)",
        kind: "number",
        read: minutesText(edit.record[rounding]) || "No rounding",
        placeholder: "No rounding",
        min: "1",
        step: "1",
      },
      {
        key: direction,
        label: "Direction",
        kind: "select",
        read: directionText(edit.record[direction]),
        options: DIRECTION_OPTIONS,
        emptyLabel: "Choose…",
      },
    ];
  }

  return (
    <SettingsFormPage
      navKey="time_rounding"
      edit={edit}
      readOnlyNote="Only the organization owner can change these settings."
    >
      <WebCardPair>
        <KeyValueCard title="Travel time" edit={edit} fields={fieldsFor("travel")} />
        <KeyValueCard title="Work time" edit={edit} fields={fieldsFor("work")} />
      </WebCardPair>
      <WebHint>
        Minimum billable duration and rounding rules, applied separately to logged Travel time and Work time: a 40 min
        travel entry with a 60 min minimum rounds up to 60 min, a 25 min work entry with 30 min rounding rounds up to 30
        min. Applied wherever hours are billed; the raw clocked times are always kept as logged. Leave a minimum or an
        interval empty to switch that rule off.
      </WebHint>
    </SettingsFormPage>
  );
}
