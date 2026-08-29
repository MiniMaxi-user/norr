"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  FormGrid,
  FormSection,
  Heading,
  Input,
  Label,
  Select,
  Stack,
  Text,
  Textarea,
  useEscapeToClose,
} from "@yourorg/ui";
import { updateTimeEntry, type TimeEntryRecord } from "../time-entries-actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";

interface TimeEntryEditState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: TimeEntryEditState = {};

/** Same local helpers as `work-order-form.tsx`'s `toDatetimeLocalValue`/
 * `toIsoDateTime` — not shared, same "each form owns its own" precedent that
 * file's own doc comment establishes for this exact pair. */
function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoDateTime(local: string): string {
  if (!local) return "";
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

export interface TimeEntryEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeEntry: TimeEntryRecord;
  /** This org's `time_entry_type` picklist values. */
  entryTypes: ReferenceListItemRecord[];
}

/**
 * Correction form for a time entry's `entryTypeId`/`startedAt`/`endedAt`/
 * `notes` — a flat, small sub-entity edit, exactly the "small popup" case
 * docs/ARCHITECTURE.md's "Popup vs. full page" standard carves out (Time
 * Entries are a sub-list of one Work Order, not a top-level module record
 * like the Work Order itself, which gets a real `/edit` page). Same
 * `useActionState` + `FormSection`/`FormGrid` shape as
 * `app/(app)/clients/contact-form-dialog.tsx`.
 *
 * `userId` reassignment is deliberately not exposed here — see
 * `time-entries-panel.tsx`'s module comment ("on-behalf-of logging") for why
 * that stays a documented follow-up rather than UI. `startedAt`/`endedAt`
 * are always resubmitted (via the hidden fields below) even when untouched,
 * same "always send the current value" shape `work-order-form.tsx` uses for
 * `scheduledAt` — leaving a datetime field blank does not clear it (Zod's
 * `optionalIsoDateTime` treats an empty string as "no change", not "set to
 * null"), so there is currently no way to reopen a completed entry as
 * running from this dialog; flagged as a minor, rarely-needed follow-up
 * rather than a schema change for this pass.
 */
export function TimeEntryEditDialog({ open, onOpenChange, timeEntry, entryTypes }: TimeEntryEditDialogProps) {
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);
  const [startedAtLocal, setStartedAtLocal] = useState(toDatetimeLocalValue(timeEntry.started_at));
  const [endedAtLocal, setEndedAtLocal] = useState(toDatetimeLocalValue(timeEntry.ended_at));

  async function action(_prevState: TimeEntryEditState, formData: FormData): Promise<TimeEntryEditState> {
    const input = Object.fromEntries(formData.entries());
    const result = await updateTimeEntry(timeEntry.id, input);
    if (result.error || !result.data) {
      return { error: result.error ?? "Something went wrong.", fieldErrors: result.fieldErrors };
    }
    return { success: true };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success) {
      onOpenChange(false);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg">
      <Dialog.Header>
        <Heading level={3}>Edit time entry</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="lg">
            {state.error && <Text tone="danger">{state.error}</Text>}

            <FormSection title="Entry" description="Type, timing, and notes.">
              <Stack gap="md">
                <Stack gap="sm">
                  <Label htmlFor="te-type">Type</Label>
                  <Select id="te-type" name="entryTypeId" defaultValue={timeEntry.entry_type_id ?? ""} required>
                    {!timeEntry.entry_type_id && (
                      <option value="" disabled>
                        Select a type…
                      </option>
                    )}
                    {entryTypes.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                  {state.fieldErrors?.entryTypeId && <Text tone="danger">{state.fieldErrors.entryTypeId[0]}</Text>}
                </Stack>

                <FormGrid columns={2}>
                  <Stack gap="sm">
                    <Label htmlFor="te-started">Started</Label>
                    <Input
                      id="te-started"
                      type="datetime-local"
                      value={startedAtLocal}
                      onChange={(event) => setStartedAtLocal(event.target.value)}
                    />
                    <input type="hidden" name="startedAt" value={toIsoDateTime(startedAtLocal)} />
                    {state.fieldErrors?.startedAt && <Text tone="danger">{state.fieldErrors.startedAt[0]}</Text>}
                  </Stack>

                  <Stack gap="sm">
                    <Label htmlFor="te-ended">Ended</Label>
                    <Input
                      id="te-ended"
                      type="datetime-local"
                      value={endedAtLocal}
                      onChange={(event) => setEndedAtLocal(event.target.value)}
                    />
                    <input type="hidden" name="endedAt" value={toIsoDateTime(endedAtLocal)} />
                    {state.fieldErrors?.endedAt && <Text tone="danger">{state.fieldErrors.endedAt[0]}</Text>}
                  </Stack>
                </FormGrid>

                <Stack gap="sm">
                  <Label htmlFor="te-notes">Notes</Label>
                  <Textarea id="te-notes" name="notes" defaultValue={timeEntry.notes ?? ""} rows={3} />
                  {state.fieldErrors?.notes && <Text tone="danger">{state.fieldErrors.notes[0]}</Text>}
                </Stack>
              </Stack>
            </FormSection>
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton />
        </Dialog.Footer>
      </form>
    </Dialog>
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
