"use client";

import { FormGrid, Label, SectionHeader, Stack, Text, Textarea } from "@yourorg/ui";
import { ShieldCheck } from "@yourorg/ui/icons";
import type { ActivityRecord } from "../actions";
import type { SolutionSubtypeRecord } from "../solution-subtype-actions";
import type { ActivityDraft } from "./activity-draft";
import { SubtypeCascadePicker } from "./subtype-cascade-picker";

type SolutionDraft = Pick<ActivityDraft, "solution" | "solutionSubtypeId">;

export interface ActivitySolutionSectionProps {
  draft: SolutionDraft;
  activity?: ActivityRecord;
  /** The org's whole flat Solution Subtype tree (issues #134/#138) — fed
   * straight into `SubtypeCascadePicker`, no `rootFilter` (unlike Activity
   * subtype, this tree is never linked to Activity Type at any level). */
  solutionSubtypes: SolutionSubtypeRecord[];
  /** Gates both fields between a plain read `Text` and an editable control —
   * same `activity-screen.tsx`'s `sectionEditing` this section's former home
   * (`ActivityAssignmentSection`) already used. */
  editing: boolean;
  /** Writes straight into the shared `draft` (`activity-screen.tsx`'s
   * `updateDraft`) on every change — no network call from here. */
  onFieldChange: (patch: Partial<SolutionDraft>) => void;
}

/**
 * "Solution" section (issue #152) — split out of `ActivityAssignmentSection`
 * into its own sibling section, same `SectionHeader` + `Stack` weight as
 * Assignment, so the "what happened" (Type/Assignment) and "how it was
 * resolved" (Solution) halves of the screen read as two distinct groups
 * instead of one long list. `activity-screen.tsx` only renders this in
 * `mode: "edit"` (a brand-new activity has no solution to write up yet — a
 * solution is authored once the melding has actually been worked, issue
 * #121) — this component itself doesn't need to know about `mode`.
 *
 * Solution subtype sits to the LEFT of Solution in a `FormGrid`, same
 * side-by-side treatment issue #152 gave Activity subtype/Description in
 * `ActivityAssignmentSection`, replacing the old stacked-above layout both
 * subtype pickers used to share.
 */
export function ActivitySolutionSection({
  draft,
  activity,
  solutionSubtypes,
  editing,
  onFieldChange,
}: ActivitySolutionSectionProps) {
  return (
    <Stack gap="md">
      <SectionHeader icon={ShieldCheck} title="Solution" />

      <FormGrid columns={2}>
        <Stack gap="xs">
          <Label htmlFor="solution-subtype-level-1">Solution subtype</Label>
          {editing ? (
            <SubtypeCascadePicker
              idBase="solution-subtype"
              ariaLabel="Solution subtype"
              nodes={solutionSubtypes}
              value={draft.solutionSubtypeId}
              onChange={(nextValue) => onFieldChange({ solutionSubtypeId: nextValue })}
            />
          ) : (
            <Text>{activity?.solution_subtype?.name ?? "No solution subtype selected."}</Text>
          )}
        </Stack>

        <Stack gap="xs">
          <Label htmlFor="activity-solution">Solution</Label>
          {editing ? (
            <Textarea
              id="activity-solution"
              aria-label="Solution"
              rows={2}
              value={draft.solution}
              onChange={(event) => onFieldChange({ solution: event.target.value })}
            />
          ) : draft.solution ? (
            <Text>{draft.solution}</Text>
          ) : (
            <Text tone="muted">No solution yet.</Text>
          )}
        </Stack>
      </FormGrid>
    </Stack>
  );
}
