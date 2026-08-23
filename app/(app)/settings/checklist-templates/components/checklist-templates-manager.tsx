"use client";

import { useState } from "react";
import { Badge, Button, Disclosure, EmptyState, Inline, Stack, Text } from "@yourorg/ui";
import { FileText } from "@yourorg/ui/icons";
import type { ChecklistTemplateItemRecord, ChecklistTemplateRecord } from "@/lib/checklist-templates/actions";
import { ChecklistTemplateFormDialog } from "./checklist-template-form-dialog";
import { DeleteChecklistTemplateDialog } from "./delete-checklist-template-dialog";
import { ChecklistTemplateItemsManager } from "./checklist-template-items-manager";

export interface ChecklistTemplatesManagerProps {
  templates: ChecklistTemplateRecord[];
  /** Every template's items, keyed by `checklist_template_id` — see
   * `ChecklistTemplatesBoard`'s doc comment for why this is fetched eagerly
   * for every template rather than lazily per `Disclosure` expand. */
  itemsByTemplateId: Record<string, ChecklistTemplateItemRecord[]>;
  /** Non-fatal — `listChecklistTemplates` failing still renders this
   * component with whatever it got, plus this message, same "don't crash the
   * whole screen" precedent `ReferenceListManager` establishes. */
  loadError?: string;
  /** `can(actor, "settings", "create")` — owner only, per the `settings`
   * RBAC row (same tier as Reference Lists). `false` renders every template
   * and its items read-only, same "everyone views, only the owner edits"
   * split `ReferenceListManager` uses. */
  canWrite: boolean;
}

/**
 * Top-level "manage checklist templates" screen: a create/rename/delete
 * affordance per template (small popup dialogs — correct per docs/
 * ARCHITECTURE.md "Popup vs. full page": these are small, flat config
 * records, not a top-level module record), and each template expands via
 * `Disclosure` to manage its own items — the natural "template has items"
 * sub-grouping, same reasoning `AssetsPanel` groups assets under `Disclosure`
 * per site rather than one flat table.
 */
export function ChecklistTemplatesManager({
  templates,
  itemsByTemplateId,
  loadError,
  canWrite,
}: ChecklistTemplatesManagerProps) {
  const [formState, setFormState] = useState<{ open: boolean; template: ChecklistTemplateRecord | null }>({
    open: false,
    template: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<ChecklistTemplateRecord | null>(null);

  function openAdd() {
    setFormState({ open: true, template: null });
  }

  function openRename(template: ChecklistTemplateRecord) {
    setFormState({ open: true, template });
  }

  return (
    <Stack gap="md">
      {loadError && <Text tone="danger">{loadError}</Text>}

      {canWrite && (
        <div>
          <Button variant="primary" size="sm" onClick={openAdd}>
            Add template
          </Button>
        </div>
      )}

      {templates.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          heading="No checklist templates yet"
          text={
            canWrite
              ? "Add your first checklist template — you'll be able to attach it to any work order."
              : "Nothing configured yet."
          }
          action={
            canWrite ? (
              <Button variant="primary" onClick={openAdd}>
                Add template
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Stack gap="sm">
          {templates.map((template) => {
            const items = itemsByTemplateId[template.id] ?? [];
            return (
              <Disclosure key={template.id} defaultOpen={templates.length === 1}>
                <Disclosure.Summary
                  meta={
                    <Badge variant="muted">
                      {items.length} item{items.length === 1 ? "" : "s"}
                    </Badge>
                  }
                >
                  {template.name}
                </Disclosure.Summary>
                <Disclosure.Content>
                  <Stack gap="md">
                    {canWrite && (
                      <Inline gap="sm">
                        <Button variant="outline" size="sm" onClick={() => openRename(template)}>
                          Rename
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => setDeleteTarget(template)}>
                          Delete template
                        </Button>
                      </Inline>
                    )}
                    <ChecklistTemplateItemsManager templateId={template.id} items={items} canWrite={canWrite} />
                  </Stack>
                </Disclosure.Content>
              </Disclosure>
            );
          })}
        </Stack>
      )}

      {canWrite && (
        <>
          <ChecklistTemplateFormDialog
            open={formState.open}
            onOpenChange={(open) => setFormState((state) => ({ ...state, open }))}
            template={formState.template}
          />
          <DeleteChecklistTemplateDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            template={deleteTarget}
          />
        </>
      )}
    </Stack>
  );
}
