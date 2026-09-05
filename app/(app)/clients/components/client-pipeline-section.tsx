"use client";

import { useEffect, useState } from "react";
import { Badge, Button, EditableSection, FormGrid, Inline, Input, KeyValueList, Label, Select, Stack, Text } from "@yourorg/ui";
import { BarChart3 } from "@yourorg/ui/icons";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import { formatCurrency } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/date";
import { CLIENT_STATUS_BADGE_VARIANT, CLIENT_STATUS_OPTIONS, type ClientStatus } from "../kanban";
import type { ClientDraft } from "./client-draft";

export interface ClientPipelineSectionProps {
  mode: "create" | "edit";
  draft: Pick<ClientDraft, "status" | "accountManagerId" | "potentialValue" | "clientSince">;
  /** Fetched once by the page, threaded down — resolves `accountManagerId`
   * into a display name, same lookup `client-detail.tsx`'s old
   * `accountManagerName` `useMemo` did. */
  accountManagers: AccountManagerRecord[];
  editing: boolean;
  onEditToggle?: (editing: boolean) => void;
  readOnly?: boolean;
  onSave: (
    patch: Pick<ClientDraft, "status" | "accountManagerId" | "potentialValue" | "clientSince">,
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Pipeline" section (Client Details tab redo) — Status/Account manager/
 * Potential/Client since, the same field set `edit-client-panel.tsx`'s old
 * "Pipeline" `FormSection` had (issue #58). Same read-card/accent-edit-card
 * toggle as `ClientBusinessDetailsSection` — see that file's doc comment.
 *
 * "Client since" defaults to today only via `emptyDraft`'s CREATE-only
 * default (`../components/client-draft.ts`) — never re-defaulted here on
 * edit, matching the old panel's explicit "don't fill this date unless it's a
 * brand-new client" rule.
 */
export function ClientPipelineSection({
  mode,
  draft,
  accountManagers,
  editing,
  onEditToggle,
  readOnly,
  onSave,
}: ClientPipelineSectionProps) {
  const [status, setStatus] = useState(draft.status);
  const [accountManagerId, setAccountManagerId] = useState(draft.accountManagerId);
  const [potentialValue, setPotentialValue] = useState(draft.potentialValue);
  const [clientSince, setClientSince] = useState(draft.clientSince);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setStatus(draft.status);
    setAccountManagerId(draft.accountManagerId);
    setPotentialValue(draft.potentialValue);
    setClientSince(draft.clientSince);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function handleCancel() {
    setStatus(draft.status);
    setAccountManagerId(draft.accountManagerId);
    setPotentialValue(draft.potentialValue);
    setClientSince(draft.clientSince);
    setError(null);
    if (mode === "edit") onEditToggle?.(false);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const result = await onSave({ status, accountManagerId, potentialValue, clientSince });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    if (mode === "edit") onEditToggle?.(false);
  }

  const accountManagerName = (() => {
    if (!draft.accountManagerId) return null;
    const manager = accountManagers.find((item) => item.id === draft.accountManagerId);
    return manager ? `${manager.first_name} ${manager.last_name}`.trim() || null : null;
  })();

  return (
    <EditableSection
      icon={BarChart3}
      title="Pipeline"
      editing={editing}
      onEdit={readOnly ? undefined : () => onEditToggle?.(true)}
      editLabel="Edit pipeline"
      editContent={
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <FormGrid columns={2}>
            <Stack gap="xs">
              <Label htmlFor="client-pipeline-status">Status</Label>
              <Select
                id="client-pipeline-status"
                value={status}
                onChange={(event) => setStatus(event.target.value as ClientStatus)}
              >
                {CLIENT_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="client-pipeline-account-manager">Account manager</Label>
              <Select
                id="client-pipeline-account-manager"
                value={accountManagerId}
                onChange={(event) => setAccountManagerId(event.target.value)}
              >
                <option value="">No account manager</option>
                {accountManagers.map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.first_name} {manager.last_name}
                  </option>
                ))}
              </Select>
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="client-pipeline-potential">Potential</Label>
              <Input
                id="client-pipeline-potential"
                type="number"
                step="1"
                min="0"
                value={potentialValue}
                onChange={(event) => setPotentialValue(event.target.value)}
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="client-pipeline-since">Client since</Label>
              <Input
                id="client-pipeline-since"
                type="date"
                value={clientSince}
                onChange={(event) => setClientSince(event.target.value)}
              />
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
          {
            key: "status",
            label: "Status",
            value: (
              <Badge variant={CLIENT_STATUS_BADGE_VARIANT[draft.status]}>
                {CLIENT_STATUS_OPTIONS.find((option) => option.value === draft.status)?.label ?? draft.status}
              </Badge>
            ),
          },
          {
            key: "accountManager",
            label: "Account manager",
            value: <Text>{accountManagerName ?? "Unassigned"}</Text>,
          },
          {
            key: "potential",
            label: "Potential",
            value: <Text>{formatCurrency(draft.potentialValue ? Number(draft.potentialValue) : null)}</Text>,
          },
          {
            key: "clientSince",
            label: "Client since",
            value: <Text>{formatDate(draft.clientSince || null)}</Text>,
          },
        ]}
      />
    </EditableSection>
  );
}
