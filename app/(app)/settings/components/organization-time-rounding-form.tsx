"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Card, FormGrid, Heading, Input, Label, Stack, Text, ViewSwitcher } from "@yourorg/ui";
import type { RoundingDirection } from "@yourorg/time-rounding";
import {
  updateOrganizationTimeRoundingSettings,
  type OrganizationTimeRoundingSettings,
} from "../organization-time-rounding-actions";

export interface OrganizationTimeRoundingFormProps {
  initial: OrganizationTimeRoundingSettings;
  /** `can(actor, "settings", "update")` — owner-only, matching this action's
   * own gate (see `../organization-time-rounding-actions.ts`'s header
   * comment). A non-owner never sees the form fields, only a read-only
   * summary — per docs/ARCHITECTURE.md's "hide, don't just disable" pattern,
   * same treatment `OrganizationDefaultRateForm` gives a non-owner. */
  canWrite: boolean;
}

interface RuleDraft {
  /** `""` = not configured (no minimum/no rounding) — a text
   * `<Input type="number">`'s own empty-string state, same convention
   * `WorkOrderDraft.durationMinutes` already uses. */
  minimumMinutes: string;
  roundingMinutes: string;
  direction: RoundingDirection;
}

function ruleToDraft(rule: OrganizationTimeRoundingSettings["travel"]): RuleDraft {
  return {
    minimumMinutes: rule.minimumMinutes === null ? "" : String(rule.minimumMinutes),
    roundingMinutes: rule.roundingMinutes === null ? "" : String(rule.roundingMinutes),
    direction: rule.direction,
  };
}

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  saved?: OrganizationTimeRoundingSettings;
}

const initialState: FormState = {};

const DIRECTION_OPTIONS = [
  { value: "up" as const, label: "Round up" },
  { value: "down" as const, label: "Round down" },
];

/**
 * Org-level travel/work minimum-duration + rounding settings (issue #198) —
 * two identically-shaped rule editors (Travel time / Work time), each a
 * minimum-duration input (a floor, applied first), a rounding-interval
 * input (applied second), and an up/down direction toggle
 * (`ViewSwitcher`, the existing two-option segmented-control pattern —
 * `../../work-orders/...`'s Dag/Week toggle is the same component). Same
 * visual language as `OrganizationDefaultRateForm` (`FormGrid` triples,
 * inline field-level errors, `useActionState` + a plain `<form action=...>`)
 * without forcing a shared component neither field shape actually needs.
 */
export function OrganizationTimeRoundingForm({ initial, canWrite }: OrganizationTimeRoundingFormProps) {
  const [travel, setTravel] = useState<RuleDraft>(() => ruleToDraft(initial.travel));
  const [work, setWork] = useState<RuleDraft>(() => ruleToDraft(initial.work));

  async function action(_prevState: FormState, formData: FormData): Promise<FormState> {
    const parseMinutes = (value: FormDataEntryValue | null): number | null => {
      const text = String(value ?? "").trim();
      return text === "" ? null : Number(text);
    };

    const input = {
      travel: {
        minimumMinutes: parseMinutes(formData.get("travelMinimumMinutes")),
        roundingMinutes: parseMinutes(formData.get("travelRoundingMinutes")),
        direction: formData.get("travelDirection") as RoundingDirection,
      },
      work: {
        minimumMinutes: parseMinutes(formData.get("workMinimumMinutes")),
        roundingMinutes: parseMinutes(formData.get("workRoundingMinutes")),
        direction: formData.get("workDirection") as RoundingDirection,
      },
    };

    const result = await updateOrganizationTimeRoundingSettings(input);
    if (result.error || !result.data) {
      return { error: result.error ?? "Could not save time rounding settings.", fieldErrors: result.fieldErrors };
    }
    return { success: true, saved: result.data.settings };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success && state.saved) {
      setTravel(ruleToDraft(state.saved.travel));
      setWork(ruleToDraft(state.saved.work));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  if (!canWrite) {
    return (
      <Card>
        <Stack gap="md">
          <RuleReadOnlyRow label="Travel time" rule={initial.travel} />
          <RuleReadOnlyRow label="Work time" rule={initial.work} />
          <Text tone="muted">Only the organization owner can change these settings.</Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Card>
      <form action={formAction}>
        <Stack gap="lg">
          {state.error && <Text tone="danger">{state.error}</Text>}
          {state.success && <Text tone="success">Time rounding settings saved.</Text>}

          <RuleFields
            idPrefix="org-time-rounding-travel"
            label="Travel time"
            namePrefix="travel"
            helperText="e.g. a 40 min travel entry with a 60 min minimum rounds up to 60 min."
            draft={travel}
            onChange={setTravel}
            errors={state.fieldErrors}
          />
          <RuleFields
            idPrefix="org-time-rounding-work"
            label="Work time"
            namePrefix="work"
            helperText="e.g. a 25 min work entry with 30 min rounding rounds up to 30 min."
            draft={work}
            onChange={setWork}
            errors={state.fieldErrors}
          />

          <div>
            <SubmitButton />
          </div>
        </Stack>
      </form>
    </Card>
  );
}

function RuleFields({
  idPrefix,
  label,
  namePrefix,
  helperText,
  draft,
  onChange,
  errors,
}: {
  idPrefix: string;
  label: string;
  namePrefix: "travel" | "work";
  helperText: string;
  draft: RuleDraft;
  onChange: (draft: RuleDraft) => void;
  errors?: Record<string, string[] | undefined>;
}) {
  // `updateOrganizationTimeRoundingSettings`'s Zod schema nests `travel`/
  // `work` as objects — `.flatten().fieldErrors` only bins by the TOP-level
  // path segment (`"travel"`/`"work"`), never a synthetic
  // `"travel.minimumMinutes"` key, so every nested issue for this rule
  // (whichever of its three fields it came from) surfaces under one shared
  // key here rather than per-input.
  const ruleErrors = errors?.[namePrefix];

  return (
    <Stack gap="xs">
      <Heading level={6}>{label}</Heading>
      <FormGrid columns={3}>
        <Stack gap="xs">
          <Label htmlFor={`${idPrefix}-minimum`}>Minimum duration (minutes)</Label>
          <Input
            id={`${idPrefix}-minimum`}
            name={`${namePrefix}MinimumMinutes`}
            type="number"
            min={0}
            step={1}
            placeholder="No minimum"
            value={draft.minimumMinutes}
            onChange={(event) => onChange({ ...draft, minimumMinutes: event.target.value })}
          />
        </Stack>
        <Stack gap="xs">
          <Label htmlFor={`${idPrefix}-rounding`}>Rounding interval (minutes)</Label>
          <Input
            id={`${idPrefix}-rounding`}
            name={`${namePrefix}RoundingMinutes`}
            type="number"
            min={1}
            step={1}
            placeholder="No rounding"
            value={draft.roundingMinutes}
            onChange={(event) => onChange({ ...draft, roundingMinutes: event.target.value })}
          />
        </Stack>
        <Stack gap="xs">
          <Label htmlFor={`${idPrefix}-direction`}>Direction</Label>
          <input type="hidden" name={`${namePrefix}Direction`} value={draft.direction} />
          <ViewSwitcher
            aria-label={`${label} rounding direction`}
            value={draft.direction}
            options={DIRECTION_OPTIONS}
            onChange={(direction) => onChange({ ...draft, direction })}
          />
        </Stack>
      </FormGrid>
      {ruleErrors?.map((message) => (
        <Text key={message} tone="danger">
          {message}
        </Text>
      ))}
      <Text tone="muted">{helperText}</Text>
    </Stack>
  );
}

function RuleReadOnlyRow({ label, rule }: { label: string; rule: OrganizationTimeRoundingSettings["travel"] }) {
  return (
    <FormGrid columns={3}>
      <Stack gap="xs">
        <Label>{label} minimum</Label>
        <Text>{rule.minimumMinutes === null ? "Not set" : `${rule.minimumMinutes} min`}</Text>
      </Stack>
      <Stack gap="xs">
        <Label>{label} rounding</Label>
        <Text>{rule.roundingMinutes === null ? "Not set" : `${rule.roundingMinutes} min`}</Text>
      </Stack>
      <Stack gap="xs">
        <Label>Direction</Label>
        <Text>{rule.direction === "up" ? "Round up" : "Round down"}</Text>
      </Stack>
    </FormGrid>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}
