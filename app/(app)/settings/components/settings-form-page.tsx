"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { toast } from "@yourorg/ui";
import { WebHint, WebSettingsMain } from "@yourorg/ui/web";
import {
  EditDiscardDialog,
  PageHeader,
  useEditMode,
  type EditModeApi,
  type EditRecord,
  type EditSchema,
  type SaveResult,
} from "@yourorg/ui/web-client";
import { findSettingsNavItemByKey } from "./settings-nav-items";

/**
 * Shared pieces of every form-type settings page (web design system, issue
 * #222): the page is one (or a few) card(s) read like a record's Overview, with
 * ONE Edit button in the header and `useEditMode` (Cancel + gold Save, Esc,
 * Ctrl/Cmd+S, "N unsaved changes", discard confirm) around the existing server
 * action. The settings frame (`SettingsShell`) only supplies the nav column
 * for these pages (`ownHeader` in `settings-nav-items.ts`); the header is the
 * `PageHeader` rendered here.
 */

export interface UseSettingsEditOptions<R extends EditRecord> {
  record: R;
  /** Must be memoized (stable between renders). */
  schema: EditSchema<R>;
  canEdit: boolean;
  /** Unique DOM-id prefix of the page's fields. */
  idPrefix: string;
  firstFieldKey?: keyof R & string;
  /** Persist through the existing server action (RBAC and zod stay there). */
  onSave: (draft: R) => Promise<SaveResult<R>>;
}

/** `useEditMode` wired for a settings page: "Saved" toast, `router.refresh()`
 * so the server values re-sync, and the in-app discard-and-leave navigation. */
export function useSettingsEdit<R extends EditRecord>({
  record,
  schema,
  canEdit,
  idPrefix,
  firstFieldKey,
  onSave,
}: UseSettingsEditOptions<R>): EditModeApi<R> {
  const router = useRouter();
  return useEditMode<R>({
    record,
    schema,
    canEdit,
    idPrefix,
    firstFieldKey,
    navigate: (href) => router.push(href),
    onSave: (draft) => onSave(draft),
    onSaved: () => {
      toast({ title: "Saved", tone: "success", duration: 3000 });
      router.refresh();
    },
  });
}

/** First message per field from an action's zod `fieldErrors`. */
export function firstFieldErrors<K extends string>(
  fieldErrors: Record<string, string[] | undefined> | undefined,
): Partial<Record<K, string>> {
  const mapped: Partial<Record<K, string>> = {};
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    if (messages?.[0]) mapped[key as K] = messages[0];
  }
  return mapped;
}

export interface SettingsFormPageProps<R extends EditRecord> {
  /** Key of the section in `SETTINGS_NAV_GROUPS` (title, breadcrumb, group). */
  navKey: string;
  edit: EditModeApi<R>;
  /** Logo/avatar slot of the header. */
  logo?: ReactNode;
  /** Muted line shown under the cards when the viewer cannot edit. */
  readOnlyNote?: string;
  children: ReactNode;
}

export function SettingsFormPage<R extends EditRecord>({
  navKey,
  edit,
  logo,
  readOnlyNote,
  children,
}: SettingsFormPageProps<R>) {
  const { group, item } = findSettingsNavItemByKey(navKey);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: item.label }]}
        title={item.label}
        logo={logo}
        badges={group.label !== item.label ? [{ label: group.label }] : []}
        mode={edit.mode}
        actions={{
          canEdit: edit.canEdit,
          onEdit: edit.startEdit,
          onSave: () => void edit.save(),
          onCancel: edit.requestCancel,
          saving: edit.saving,
          saveLabel: "Save",
        }}
        editStatus={edit.status}
      />
      <WebSettingsMain>
        <div className="web-tab-stack">
          {children}
          {!edit.canEdit && readOnlyNote ? <WebHint>{readOnlyNote}</WebHint> : null}
        </div>
      </WebSettingsMain>
      <EditDiscardDialog confirm={edit.confirm} />
    </>
  );
}
