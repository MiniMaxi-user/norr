"use client";
// Interactive half of the web design system (issue #222): everything that
// owns state or event handlers — `WebMenu`, `PageHeader`, `KeyValueCard`,
// `TextCard`, the confirm dialogs and the `useEditMode` hook. Its own build
// entry (`dist/web-client.js`, see tsup.config.ts) so the main `index.js` the
// PWA also consumes is never touched; the server-safe primitives live in
// `./index.ts`.

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Dialog } from "../components/dialog";
import { useEscapeToClose } from "../use-escape-to-close";
import { Check, Pencil } from "../icons";
import {
  WebBadge,
  WebBreadcrumb,
  WebButton,
  WebCard,
  type WebBadgeVariant,
  type WebBreadcrumbItem,
} from "./primitives";
import { WebMenu, type WebMenuItem } from "./menu";
import type { ConfirmState, EditStatus, FieldBinding } from "./edit-mode";
import { scrollMainToTop } from "./scroll";

export { useEditMode } from "./edit-mode";
export { WebMenu } from "./menu";
export { scrollMainToTop } from "./scroll";
export { LivePanel } from "./live-panel";
export { WebListFilterBar } from "./list-filter-bar";
export { WebQuickFilters } from "./quick-filters";
export type { WebQuickFilter } from "./quick-filters";
export type { WebListFilterBarProps } from "./list-filter-bar";
export type { LivePanelAction, LivePanelData, LivePanelVariant } from "./live-panel";
export { WebFloatingCard, WebMultiSelectFilter } from "./planning";
export type { WebFloatingCardProps, WebMultiSelectFilterProps, WebMultiSelectOption } from "./planning";
export { StructureTree } from "./structure-tree";
export type { StructureTreeNode, StructureTreeProps } from "./structure-tree";
export type { WebMenuItem, WebMenuProps } from "./menu";
export {
  FilterBar,
  StatusText,
  WebDataTableCard,
  WebViewSwitcher,
  toneFromColor,
} from "./data-table";
export type {
  FilterBarDropdown,
  FilterBarProps,
  FilterBarSegment,
  FilterOption,
  StatusTone,
  WebColumn,
  WebDataTableCardProps,
  WebDropdownDef,
  WebSegmentDef,
  WebServerListState,
} from "./data-table";
export type {
  ConfirmState,
  DirtyField,
  EditModeApi,
  EditModeName,
  EditRecord,
  EditSchema,
  EditStatus,
  FieldBinding,
  FieldRule,
  FieldValue,
  SaveResult,
  UseEditModeOptions,
} from "./edit-mode";

/* ---------------------------------------------------------------------- *
 * Confirm dialogs
 * ---------------------------------------------------------------------- */

export interface WebConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  cancelLabel?: string;
  confirmLabel: string;
  /** `danger` only for the destructive confirmation button. */
  confirmVariant?: "primary" | "danger" | "save";
  pending?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function WebConfirmDialog({
  open,
  title,
  children,
  cancelLabel = "Cancel",
  confirmLabel,
  confirmVariant = "primary",
  pending,
  error,
  onCancel,
  onConfirm,
}: WebConfirmDialogProps) {
  const handleOpenChange = (next: boolean) => {
    if (!next && !pending) onCancel();
  };
  // The shared Dialog has no Escape handling of its own (see dialog.tsx).
  useEscapeToClose(open, handleOpenChange);
  return (
    <Dialog open={open} onOpenChange={handleOpenChange} size="sm">
      <Dialog.Header>
        <h2 className="web-dialog-title">{title}</h2>
      </Dialog.Header>
      <Dialog.Body>
        <div className="web-dialog-text">{children}</div>
        {error ? (
          <p className="web-dialog-error" role="alert">
            <span className="web-error-mark" aria-hidden="true">
              !
            </span>
            {error}
          </p>
        ) : null}
      </Dialog.Body>
      <Dialog.Footer>
        {/* The safe choice takes initial focus. */}
        <WebButton autoFocus onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </WebButton>
        <WebButton variant={confirmVariant} loading={pending} onClick={onConfirm}>
          {confirmLabel}
        </WebButton>
      </Dialog.Footer>
    </Dialog>
  );
}

/** "Discard changes? 3 fields were changed." — wired straight to
 * `useEditMode().confirm`. */
export function EditDiscardDialog({ confirm }: { confirm: ConfirmState }) {
  const count = confirm.fieldCount;
  return (
    <WebConfirmDialog
      open={confirm.open}
      title="Discard changes?"
      cancelLabel="Keep editing"
      confirmLabel="Discard"
      confirmVariant="danger"
      onCancel={confirm.keepEditing}
      onConfirm={confirm.discard}
    >
      {count} {count === 1 ? "field was" : "fields were"} changed.
      {confirm.reason === "leave" ? " You will leave this page." : ""}
    </WebConfirmDialog>
  );
}

/* ---------------------------------------------------------------------- *
 * PageHeader
 * ---------------------------------------------------------------------- */

export interface PageHeaderBadge {
  label: ReactNode;
  variant?: WebBadgeVariant;
}

export interface PageHeaderTab {
  id: string;
  label: string;
  /** Mono number in a pill, no brackets. Omit (or 0) when there is nothing
   * to count — no pill is shown for 0. */
  count?: number | null;
  /** The count needs attention (open, overdue, to review): the pill turns
   * gold and shows this word after the number ("3 open"). Only the first
   * such tab in the band is highlighted. */
  attention?: string | null;
}

export interface PageHeaderActions {
  /** No write permission => the Edit button is omitted entirely. */
  canEdit: boolean;
  onEdit: () => void;
  /** Contents of the ··· menu (rare or dangerous actions). */
  overflow?: WebMenuItem[];
  /** The ONE navy primary action of read mode. */
  primary?: ReactNode;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
  /** "Save" for edit mode, "Create client" for new mode. */
  saveLabel?: string;
}

export interface PageHeaderProps {
  breadcrumb: WebBreadcrumbItem[];
  /** The human name of the record. One H1 per page. */
  title: string;
  /** Logo/avatar slot (52px), e.g. a client logo or its uploader. */
  logo?: ReactNode;
  /** At most 5, ordered: main status, warnings, classification, facts, ID. */
  badges?: PageHeaderBadge[];
  mode: "read" | "edit" | "new";
  actions: PageHeaderActions;
  /** Owner line under the buttons (account manager, engineer, ...). */
  owner?: { name: string; role?: string } | null;
  tabs?: PageHeaderTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  tabsLabel?: string;
  editStatus?: EditStatus;
}

/** id/aria wiring shared by `PageHeader`'s tabs and the page's panel. */
export function webTabIds(id: string) {
  return { tab: `web-tab-${id}`, panel: `web-tabpanel-${id}` };
}

const MAX_BADGES = 5;
const MAX_FILLED_BADGES = 2;

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

function focusById(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  element.focus({ preventScroll: true });
}

function EditStatusRegion({ mode, status }: { mode: "edit" | "new"; status?: EditStatus }) {
  const errors = status?.errors ?? [];
  const changed = status?.changedCount ?? 0;
  let body: ReactNode;
  if (status?.serverError) {
    body = (
      <span className="web-edit-status-problem" title={`Save failed: ${status.serverError}. Try again.`}>
        <span className="web-error-mark" aria-hidden="true">
          !
        </span>
        Save failed: {status.serverError}. Try again.
      </span>
    );
  } else if (errors.length > 0) {
    body = (
      <>
        <span
          className="web-edit-status-problem"
          title={`${errors.length} ${errors.length === 1 ? "field needs" : "fields need"} attention: ${errors.map((error) => error.label).join(" · ")}`}
        >
          <span className="web-error-mark" aria-hidden="true">
            !
          </span>
          {errors.length} {errors.length === 1 ? "field needs" : "fields need"} attention:
          {errors.map((error, index) => (
            <span key={error.key}>
              {index > 0 ? " · " : " "}
              <a
                href={`#${error.fieldId}`}
                onClick={(event) => {
                  event.preventDefault();
                  focusById(error.fieldId);
                }}
              >
                {error.label}
              </a>
            </span>
          ))}
        </span>
        {mode === "edit" && changed > 0 ? (
          <>
            <span className="web-edit-status-divider" aria-hidden="true">
              |
            </span>
            <span>
              {changed} {changed === 1 ? "change" : "changes"} not saved yet
            </span>
          </>
        ) : null}
      </>
    );
  } else if (mode === "new") {
    body = <span>Fields marked * are required</span>;
  } else if (changed > 0) {
    body = (
      <span>
        {changed} unsaved {changed === 1 ? "change" : "changes"}
      </span>
    );
  } else {
    body = <span>No changes yet</span>;
  }

  return (
    <div className="web-edit-status" role="status" aria-live="polite">
      <WebBadge variant="warning">{mode === "new" ? "New" : "Edit mode"}</WebBadge>
      {body}
    </div>
  );
}

/** Dark (navy) header of every detail page: breadcrumb, title, badges (or,
 * while editing, the edit-status line), actions, owner line, and the darker
 * tab band whose active tab is a light folder tab. */
export function PageHeader({
  breadcrumb,
  title,
  logo,
  badges,
  mode,
  actions,
  owner,
  tabs,
  activeTab,
  onTabChange,
  tabsLabel = "Sections",
  editStatus,
}: PageHeaderProps) {
  const editing = mode !== "read";
  // Max 5 badges; at most 2 of them filled (bright) — the rest neutral.
  let filled = 0;
  const visibleBadges = (badges ?? []).slice(0, MAX_BADGES).map((badge) => {
    const isFilled = badge.variant !== undefined && badge.variant !== "neutral" && badge.variant !== "mono";
    if (!isFilled) return badge;
    filled += 1;
    return filled <= MAX_FILLED_BADGES ? badge : { ...badge, variant: "neutral" as const };
  });
  // At most one gold count pill per tab band.
  const firstAttentionTab = (tabs ?? []).findIndex((tab) => Boolean(tab.attention && tab.count));

  // Return focus to the Edit button when leaving edit mode.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) document.getElementById("web-edit-button")?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const onTabsKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (editing || !tabs || !onTabChange) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") {
        return;
      }
      event.preventDefault();
      const index = Math.max(
        0,
        tabs.findIndex((tab) => tab.id === activeTab),
      );
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      const target = tabs[next];
      if (!target) return;
      onTabChange(target.id);
      scrollMainToTop();
      requestAnimationFrame(() => document.getElementById(webTabIds(target.id).tab)?.focus());
    },
    [activeTab, editing, onTabChange, tabs],
  );

  return (
    <header className="web-page-header" data-mode={mode}>
      <WebBreadcrumb items={breadcrumb} editCrumb={editing ? (mode === "new" ? undefined : "Edit") : undefined} />

      <div className="web-page-header-row">
        <div className="web-page-header-left">
          {logo ? <div className="web-page-header-logo">{logo}</div> : null}
          <div className="web-page-header-text">
            <h1 className="web-page-title" title={title}>
              {title}
            </h1>
            {editing ? (
              <EditStatusRegion mode={mode === "new" ? "new" : "edit"} status={editStatus} />
            ) : visibleBadges.length > 0 ? (
              <div className="web-badge-row">
                {visibleBadges.map((badge, index) => (
                  <WebBadge key={index} variant={badge.variant}>
                    {badge.label}
                  </WebBadge>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="web-page-header-actions">
          <div className="web-page-header-buttons">
            {editing ? (
              <>
                <WebButton onClick={actions.onCancel} disabled={actions.saving}>
                  Cancel
                </WebButton>
                <WebButton variant="save" loading={actions.saving} onClick={actions.onSave}>
                  {actions.saving ? (
                    "Saving…"
                  ) : (
                    <>
                      <Check aria-hidden />
                      {actions.saveLabel ?? "Save"}
                    </>
                  )}
                </WebButton>
              </>
            ) : (
              <>
                {actions.canEdit ? (
                  <WebButton id="web-edit-button" onClick={actions.onEdit}>
                    <Pencil aria-hidden />
                    Edit
                  </WebButton>
                ) : null}
                {actions.overflow && actions.overflow.length > 0 ? (
                  <WebMenu
                    label="More actions"
                    triggerClassName="web-btn web-btn-icon"
                    trigger={
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="5" cy="12" r="1.8" />
                        <circle cx="12" cy="12" r="1.8" />
                        <circle cx="19" cy="12" r="1.8" />
                      </svg>
                    }
                    items={actions.overflow}
                  />
                ) : null}
                {actions.primary}
              </>
            )}
          </div>
          {editing ? (
            <span className="web-page-header-owner">Esc = cancel · Ctrl+S = save</span>
          ) : owner ? (
            <span className="web-page-header-owner">
              <span className="web-owner-avatar" aria-hidden="true">
                {initialsOf(owner.name)}
              </span>
              <span className="web-page-header-owner-text">
                {owner.name}
                {owner.role ? ` · ${owner.role}` : ""}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      {tabs && tabs.length > 0 ? (
        <div className="web-tabs" role="tablist" aria-label={tabsLabel} onKeyDown={onTabsKeyDown}>
          {tabs.map((tab, tabIndex) => {
            const selected = tab.id === activeTab;
            const locked = editing && !selected;
            const ids = webTabIds(tab.id);
            return (
              <button
                key={tab.id}
                id={ids.tab}
                type="button"
                role="tab"
                className="web-tab"
                aria-selected={selected}
                aria-controls={ids.panel}
                aria-disabled={editing ? "true" : undefined}
                tabIndex={selected && !editing ? 0 : -1}
                onClick={() => {
                  if (locked || selected) return;
                  onTabChange?.(tab.id);
                  scrollMainToTop();
                }}
              >
                {tab.label}
                {tab.count ? (
                  tab.attention && tabIndex === firstAttentionTab ? (
                    <span className="web-tab-count" data-attention="true">
                      {tab.count} {tab.attention}
                    </span>
                  ) : (
                    <span className="web-tab-count">{tab.count}</span>
                  )
                ) : null}
              </button>
            );
          })}
          {editing ? <span className="web-tabs-note">Tabs locked until you save or cancel</span> : null}
        </div>
      ) : null}
    </header>
  );
}

/* ---------------------------------------------------------------------- *
 * KeyValueCard / TextCard
 * ---------------------------------------------------------------------- */

/** The slice of `useEditMode()` the cards need. Declared with method
 * syntax so a `useEditMode<Draft>()` result is assignable. */
export interface KvEditBinder {
  isEditing: boolean;
  getField(key: string): FieldBinding;
  countsFor(keys: readonly string[]): { errors: number; changed: number };
}

export interface KvOption {
  value: string;
  label: string;
}

export type KvKind = "text" | "number" | "money" | "date" | "datetime" | "select" | "checkbox" | "derived";

export interface KvField {
  /** Draft key (must exist in the edit schema) — for `derived` just a
   * unique id. */
  key: string;
  label: string;
  kind?: KvKind;
  /** Read-mode content. `null`/`undefined`/`""` render the muted `—`. */
  read: ReactNode;
  placeholder?: string;
  options?: KvOption[];
  /** Placeholder option of a select ("No account manager"). */
  emptyLabel?: string;
  /** Mono face (IDs, IBAN). */
  mono?: boolean;
  step?: string;
  min?: string;
  /** Dependent field: disabled until its parent has a value. Pair with
   * `disabledNote` ("Turn on custom rate first"). */
  disabled?: boolean;
  disabledNote?: string;
  /** Derived fields: explanation under the grey value ("Edit under Sites"). */
  note?: string;
  /** Checkbox text next to the box. */
  checkboxLabel?: string;
  maxLength?: number;
  autoComplete?: string;
}

function isEmptyNode(node: ReactNode) {
  return node === null || node === undefined || node === "" || node === false;
}

function ReadRow({ field }: { field: KvField }) {
  const empty = isEmptyNode(field.read);
  return (
    <div className="web-kv-row">
      <span className="web-kv-label">{field.label}</span>
      <span
        className="web-kv-value"
        data-empty={empty ? "true" : undefined}
        data-mono={field.mono ? "true" : undefined}
        data-numeric={field.kind === "money" || field.kind === "number" ? "true" : undefined}
      >
        {empty ? "—" : field.read}
      </span>
    </div>
  );
}

function EditRow({ field, binding }: { field: KvField; binding: FieldBinding | null }) {
  const kind = field.kind ?? "text";

  if (kind === "derived" || !binding) {
    const empty = isEmptyNode(field.read);
    return (
      <div className="web-field" data-state="derived" data-has-message={field.note ? "true" : undefined}>
        <span className="web-field-label">{field.label}</span>
        <div className="web-field-control">
          <div className="web-field-derived" data-empty={empty ? "true" : undefined}>
            {empty ? "—" : field.read}
          </div>
        </div>
        {field.note ? <div className="web-field-message">{field.note}</div> : null}
      </div>
    );
  }

  const state = binding.error ? "error" : binding.changed ? "changed" : "normal";
  let message: ReactNode = null;
  if (binding.error) {
    message = (
      <>
        <span className="web-error-mark" aria-hidden="true">
          !
        </span>
        {binding.error}
      </>
    );
  } else if (field.disabled && field.disabledNote) {
    message = field.disabledNote;
  } else if (binding.changed) {
    message = `Changed · was ${binding.wasText ? binding.wasText : "empty"}`;
  }
  const describedBy = message ? binding.messageId : undefined;
  const common = {
    id: binding.id,
    name: binding.key,
    "aria-invalid": binding.error ? (true as const) : undefined,
    "aria-describedby": describedBy,
    "aria-required": binding.required ? (true as const) : undefined,
    disabled: field.disabled,
    onBlur: binding.onBlur,
  };

  let control: ReactNode;
  if (kind === "select") {
    control = (
      <select
        {...common}
        className="web-select"
        value={String(binding.value)}
        onChange={(event) => binding.onChange(event.target.value)}
      >
        <option value="">{field.emptyLabel ?? "Select…"}</option>
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else if (kind === "checkbox") {
    control = (
      <label className="web-field-checkbox">
        <input
          {...common}
          type="checkbox"
          checked={Boolean(binding.value)}
          onChange={(event) => binding.onChange(event.target.checked)}
        />
        {field.checkboxLabel ?? field.label}
      </label>
    );
  } else {
    const type =
      kind === "money" || kind === "number" ? "number" : kind === "date" ? "date" : kind === "datetime" ? "datetime-local" : "text";
    control = (
      <input
        {...common}
        className="web-input"
        type={type}
        inputMode={kind === "money" ? "decimal" : undefined}
        step={field.step ?? (kind === "money" ? "0.01" : undefined)}
        min={field.min ?? (kind === "money" ? "0" : undefined)}
        maxLength={field.maxLength}
        autoComplete={field.autoComplete ?? "off"}
        placeholder={field.placeholder}
        data-numeric={kind === "money" || kind === "number" ? "true" : undefined}
        data-mono={field.mono ? "true" : undefined}
        value={String(binding.value)}
        onChange={(event) => binding.onChange(event.target.value)}
      />
    );
  }

  return (
    <div className="web-field" data-state={state} data-has-message={message ? "true" : undefined}>
      <label className="web-field-label" htmlFor={binding.id}>
        {field.label}
        {binding.required ? (
          <span className="web-field-required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <div className="web-field-control">{control}</div>
      {message ? (
        <div id={binding.messageId} className="web-field-message">
          {message}
        </div>
      ) : null}
    </div>
  );
}

function CardCounts({ edit, keys }: { edit?: KvEditBinder; keys: readonly string[] }) {
  if (!edit?.isEditing) return null;
  const counts = edit.countsFor(keys);
  return (
    <>
      {counts.errors > 0 ? (
        <span className="web-card-errors">
          {counts.errors} {counts.errors === 1 ? "error" : "errors"}
        </span>
      ) : null}
      {counts.changed > 0 ? <span className="web-card-changed">· {counts.changed} changed</span> : null}
    </>
  );
}

export interface KeyValueCardProps {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  /** 1 or 2 columns. Two columns for 6–12 fields about one subject; each
   * column is 320–560px wide. */
  columns?: 1 | 2;
  /** Index where the second column starts (default: half). */
  split?: number;
  fields: KvField[];
  /** Omit for a never-editable card. */
  edit?: KvEditBinder;
}

/** Card whose rows are the read value or, in edit/new mode, the input for
 * the same field — in the same place and at the same height. */
export function KeyValueCard({ title, meta, action, columns = 1, split, fields, edit }: KeyValueCardProps) {
  const editing = Boolean(edit?.isEditing);
  const splitAt = columns === 2 ? (split ?? Math.ceil(fields.length / 2)) : fields.length;
  const groups = columns === 2 ? [fields.slice(0, splitAt), fields.slice(splitAt)] : [fields];
  const editableKeys = fields.filter((field) => (field.kind ?? "text") !== "derived").map((field) => field.key);

  return (
    <WebCard
      title={title}
      meta={meta}
      action={action}
      headExtra={<CardCounts edit={edit} keys={editableKeys} />}
      data-kv-columns={columns}
    >
      <div className="web-kv" data-columns={columns}>
        {groups.map((group, index) => (
          <div className="web-kv-col" key={index}>
            {group.map((field) =>
              editing ? (
                <EditRow
                  key={field.key}
                  field={field}
                  binding={(field.kind ?? "text") === "derived" || !edit ? null : edit.getField(field.key)}
                />
              ) : (
                <ReadRow key={field.key} field={field} />
              ),
            )}
          </div>
        ))}
      </div>
    </WebCard>
  );
}

export interface TextCardProps {
  title: string;
  /** Draft key of the text field. */
  fieldKey: string;
  /** Saved text (read mode). */
  text: string;
  emptyText?: string;
  rows?: number;
  placeholder?: string;
  edit?: KvEditBinder;
}

/** Running-text card (notes): measure-limited body text, or one textarea. */
export function TextCard({ title, fieldKey, text, emptyText = "No notes yet.", rows = 4, placeholder, edit }: TextCardProps) {
  const editing = Boolean(edit?.isEditing);
  const binding = editing && edit ? edit.getField(fieldKey) : null;
  const message = binding?.error ?? (binding?.changed ? `Changed · was ${binding.wasText ? "set" : "empty"}` : null);

  return (
    <WebCard title={title} headExtra={<CardCounts edit={edit} keys={[fieldKey]} />}>
      {binding ? (
        <div className="web-card-textarea-wrap">
          <div className="web-textarea-field" data-state={binding.error ? "error" : binding.changed ? "changed" : "normal"}>
            <textarea
              id={binding.id}
              name={binding.key}
              className="web-textarea"
              rows={rows}
              placeholder={placeholder}
              aria-label={title}
              aria-invalid={binding.error ? true : undefined}
              aria-describedby={message ? binding.messageId : undefined}
              value={String(binding.value)}
              onChange={(event) => binding.onChange(event.target.value)}
              onBlur={binding.onBlur}
            />
            {message ? (
              <div id={binding.messageId} className="web-field-message">
                {binding.error ? (
                  <span className="web-error-mark" aria-hidden="true">
                    !
                  </span>
                ) : null}
                {message}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="web-card-text" data-empty={text.trim() ? undefined : "true"}>
          {text.trim() ? text : emptyText}
        </p>
      )}
    </WebCard>
  );
}

export { WebPhotoGallery } from "./photo-gallery";
export type { WebPhotoGalleryProps, WebPhotoItem } from "./photo-gallery";
