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
import { createTimeEntry } from "../time-entries-actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";

interface TimeEntryCreateState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: TimeEntryCreateState = {};

/** Same local helpers as `work-order-form.tsx`'s `toDatetimeLocalValue`/
 * `toIsoDateTime` / `time-entry-edit-dialog.tsx`'s copy of the same pair —
 * not shared, same "each form owns its own" precedent those files already
 * establish. */
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

export interface TimeEntryCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  /** "Log travel time" / "Log work time" — the dialog's own header, doubling
   * as which section triggered it. */
  title: string;
  /**
   * This org's `time_entry_type` item id for the section that opened this
   * dialog (Travel or Labor) — submitted as a fixed hidden field, never a
   * picker, since the section context already determines it (issue #87: "een
   * type-picker in deze nieuwe dialog wordt niet getoond — de sectie bepaalt
   * het type al"). `undefined` only if that org's `time_entry_type` list is
   * somehow missing the expected seeded item — omitted entirely in that edge
   * case, so `createTimeEntry`'s own DB-trigger default (Labor) applies
   * rather than submitting a bad value.
   */
  entryTypeId: string | undefined;
  /** This org's engineer-role members only (already filtered by the caller,
   * `time-entries-panel.tsx`) — issue #87's "Per werktijd/reistijd wordt de
   * standaard engineer gekoppeld, maar is evt te wijzigen" picker. */
  engineers: OrgMemberRecord[];
  /** The work order's own `assigned_to` ("standard engineer") — pre-selects
   * this dialog's engineer picker when it's among `engineers`, mirroring
   * `createTimeEntry`'s own server-side default for an omitted `userId`. */
  defaultUserId?: string | null;
}

/**
 * Manual travel/work time entry — a small, secondary sub-entity dialog
 * reached from one of `TimeEntriesPanel`'s two sections (Travel/Work times),
 * correctly a popup per docs/ARCHITECTURE.md "Popup vs. full page" (issue
 * #87). Calls `createTimeEntry` (not `clockIn`) since the actual start —
 * and, optionally, end — time is already known, unlike a live clock-in.
 *
 * No entry-type picker here by design — `entryTypeId` is fixed by which
 * section's "Add" button opened this dialog. No `userId`-omission fallback
 * either: the engineer `<Select>` always submits an explicit value (defaults
 * to `defaultUserId` when it's a known engineer, otherwise the caller must
 * pick one) so the visible default and the value actually saved never
 * silently disagree.
 */
export function TimeEntryCreateDialog({
  open,
  onOpenChange,
  workOrderId,
  title,
  entryTypeId,
  engineers,
  defaultUserId,
}: TimeEntryCreateDialogProps) {
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  const initialUserId = engineers.some((engineer) => engineer.id === defaultUserId) ? (defaultUserId ?? "") : "";
  const [startedAtLocal, setStartedAtLocal] = useState(() => toDatetimeLocalValue(new Date().toISOString()));
  const [endedAtLocal, setEndedAtLocal] = useState("");

  async function action(_prevState: TimeEntryCreateState, formData: FormData): Promise<TimeEntryCreateState> {
    const input = Object.fromEntries(formData.entries());
    const result = await createTimeEntry(workOrderId, input);
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
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>{title}</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="lg">
            {state.error && <Text tone="danger">{state.error}</Text>}

            {entryTypeId && <input type="hidden" name="entryTypeId" value={entryTypeId} />}

            <FormSection title="Entry" description="Who, and when.">
              <Stack gap="md">
                <Stack gap="sm">
                  <Label htmlFor="tec-user">Engineer</Label>
                  <Select id="tec-user" name="userId" defaultValue={initialUserId} required>
                    {!initialUserId && (
                      <option value="" disabled>
                        Select an engineer…
                      </option>
                    )}
                    {engineers.map((engineer) => (
                      <option key={engineer.id} value={engineer.id}>
                        {memberDisplayName(engineer)}
                      </option>
                    ))}
                  </Select>
                  {state.fieldErrors?.userId && <Text tone="danger">{state.fieldErrors.userId[0]}</Text>}
                </Stack>

                <FormGrid columns={2}>
                  <Stack gap="sm">
                    <Label htmlFor="tec-started">Started *</Label>
                    <Input
                      id="tec-started"
                      type="datetime-local"
                      value={startedAtLocal}
                      onChange={(event) => setStartedAtLocal(event.target.value)}
                      required
                    />
                    <input type="hidden" name="startedAt" value={toIsoDateTime(startedAtLocal)} />
                    {state.fieldErrors?.startedAt && <Text tone="danger">{state.fieldErrors.startedAt[0]}</Text>}
                  </Stack>

                  <Stack gap="sm">
                    <Label htmlFor="tec-ended">Ended</Label>
                    <Input
                      id="tec-ended"
                      type="datetime-local"
                      value={endedAtLocal}
                      onChange={(event) => setEndedAtLocal(event.target.value)}
                    />
                    <input type="hidden" name="endedAt" value={toIsoDateTime(endedAtLocal)} />
                    {state.fieldErrors?.endedAt && <Text tone="danger">{state.fieldErrors.endedAt[0]}</Text>}
                    <Text tone="muted">Leave blank to log this entry as still running.</Text>
                  </Stack>
                </FormGrid>

                <Stack gap="sm">
                  <Label htmlFor="tec-notes">Notes</Label>
                  <Textarea id="tec-notes" name="notes" rows={3} />
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
      {pending ? "Saving…" : "Add entry"}
    </Button>
  );
}
