"use client";

import { useEffect, useState } from "react";
import { Button, EditableSection, FormGrid, Inline, Input, KeyValueList, Label, Stack, Text } from "@yourorg/ui";
import { CalendarDays } from "@yourorg/ui/icons";
import type { ContractRecord } from "../actions";
import { formatDate, formatDateTime } from "@/lib/format/date";
import type { ContractDraft } from "./contract-draft";

export interface ContractDatesSectionProps {
  mode: "create" | "edit";
  draft: Pick<ContractDraft, "startDate" | "endDate">;
  contract?: ContractRecord;
  editing: boolean;
  onEditToggle?: (editing: boolean) => void;
  readOnly?: boolean;
  onSave: (patch: Pick<ContractDraft, "startDate" | "endDate">) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Dates" section (issue #122) — when this contract is (or was) in effect.
 * Same read-card/accent-edit-card toggle every other section on this screen
 * uses.
 */
export function ContractDatesSection({
  mode,
  draft,
  contract,
  editing,
  onEditToggle,
  readOnly,
  onSave,
}: ContractDatesSectionProps) {
  const [startDate, setStartDate] = useState(draft.startDate);
  const [endDate, setEndDate] = useState(draft.endDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setStartDate(draft.startDate);
    setEndDate(draft.endDate);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function handleCancel() {
    setStartDate(draft.startDate);
    setEndDate(draft.endDate);
    setError(null);
    if (mode === "edit") onEditToggle?.(false);
  }

  async function handleSave() {
    if (!startDate) {
      setError("Start date is required.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave({ startDate, endDate });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    if (mode === "edit") onEditToggle?.(false);
  }

  return (
    <EditableSection
      icon={CalendarDays}
      title="Dates"
      editing={editing}
      onEdit={readOnly ? undefined : () => onEditToggle?.(true)}
      editLabel="Edit dates"
      editContent={
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <FormGrid columns={2}>
            <Stack gap="xs">
              <Label htmlFor="contract-dates-start">Start date</Label>
              <Input
                id="contract-dates-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                required
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="contract-dates-end">End date</Label>
              <Input id="contract-dates-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              <Text tone="muted">Leave blank for an open-ended contract.</Text>
            </Stack>
          </FormGrid>
          <Inline gap="sm" justify="end">
            {mode === "edit" && (
              <Button type="button" variant="outline" onClick={handleCancel} disabled={saving}>
                Cancel
              </Button>
            )}
            <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </Inline>
        </Stack>
      }
    >
      <KeyValueList
        items={[
          { key: "start", label: "Start date", value: <Text>{formatDate(contract?.start_date ?? null, { month: "long" })}</Text> },
          { key: "end", label: "End date", value: <Text>{formatDate(contract?.end_date ?? null, { month: "long" })}</Text> },
          {
            key: "created",
            label: "Created",
            value: <Text>{contract ? formatDateTime(contract.created_at, { month: "long" }) : "—"}</Text>,
          },
        ]}
      />
    </EditableSection>
  );
}
