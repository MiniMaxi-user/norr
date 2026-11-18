import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * `useEditMode` — the ONE mechanism behind a detail page's read / edit / new
 * modes (issue #222, docs "03 Bewerken en validatie" + "04 Ombouwplan" step 7).
 * Every field in `KeyValueCard` reads from this instead of owning its own
 * state, so an edit-mode page behaves the same everywhere:
 *
 *  - `mode`, `draft`, `dirtyFields` (with the old value), per-field `errors`;
 *  - validate on blur; once a field has an error, re-validate on every change;
 *    `validateAll` on save, focusing the first invalid field;
 *  - `save` (async, server errors are mapped back to fields when possible);
 *  - `requestCancel` — Esc / Cancel; asks for confirmation when dirty;
 *  - Ctrl/Cmd+S saves; `beforeunload` plus a capture-phase click guard on
 *    in-app links protect unsaved changes.
 *
 * The draft is a flat record of strings/booleans (raw input shaped, like the
 * existing `ClientDraft`); conversion to the server input happens in the
 * caller's `onSave`.
 */

export type FieldValue = string | boolean;
export type EditRecord = Record<string, FieldValue>;
export type EditModeName = "read" | "edit" | "new";

export interface FieldRule<R extends EditRecord, K extends keyof R & string = keyof R & string> {
  /** Label shown on the row, in messages and in the header status. */
  label: string;
  /** Marks the row with `*` and (via `validate`) is required. Purely visual:
   * put the actual rule in `validate`. */
  required?: boolean;
  /** Return a message that says what is wrong AND how to fix it, or
   * `null`/`undefined` when the value is fine. Mirror the backend rules. */
  validate?: (value: R[K], draft: R) => string | null | undefined;
  /** Text for "Changed · was …" — defaults to the raw string value. */
  format?: (value: R[K], draft: R) => string;
}

export type EditSchema<R extends EditRecord> = { [K in keyof R & string]: FieldRule<R, K> };

export interface DirtyField<R extends EditRecord> {
  key: keyof R & string;
  label: string;
  oldValue: FieldValue;
  newValue: FieldValue;
  /** Formatted old value ("was …"). */
  oldText: string;
}

export type SaveResult<R extends EditRecord> =
  | { ok: true }
  | { ok: false; error?: string; fieldErrors?: Partial<Record<keyof R & string, string>> };

export interface FieldBinding {
  id: string;
  key: string;
  label: string;
  required: boolean;
  value: FieldValue;
  /** Changed from the saved value (edit mode only). */
  changed: boolean;
  /** "was …" text for the changed message. */
  wasText: string | null;
  error: string | null;
  /** id of the message element (`aria-describedby` target). */
  messageId: string;
  onChange: (value: FieldValue) => void;
  onBlur: () => void;
}

export interface EditStatus {
  kind: "edit" | "new";
  changedCount: number;
  errors: { fieldId: string; key: string; label: string }[];
  serverError: string | null;
}

export interface ConfirmState {
  open: boolean;
  /** What triggered it: Cancel/Esc, or navigating away. */
  reason: "cancel" | "leave";
  fieldCount: number;
  keepEditing: () => void;
  discard: () => void;
}

export interface UseEditModeOptions<R extends EditRecord> {
  /** The saved values (for `new`: the empty defaults). Re-synced whenever
   * its content changes while not editing. */
  record: R;
  schema: EditSchema<R>;
  initialMode?: "read" | "new";
  /** Without write permission the page must not offer Edit at all. */
  canEdit?: boolean;
  /** Prefix for DOM ids of the fields (unique per page). */
  idPrefix?: string;
  /** Persist. Throwing is treated as a generic server error. */
  onSave: (draft: R, dirty: DirtyField<R>[]) => Promise<SaveResult<R>>;
  /** After a successful save (edit: back in read mode; new: still in `new`
   * — navigate away here). */
  onSaved?: (draft: R) => void;
  /** Called when a `new` page is cancelled/discarded (navigate back). */
  onCancelNew?: () => void;
  /** Used for the discard-and-leave flow (`router.push`). */
  navigate?: (href: string) => void;
  /** Key of the field to focus when entering edit mode. */
  firstFieldKey?: keyof R & string;
}

export interface EditModeApi<R extends EditRecord> {
  mode: EditModeName;
  isEditing: boolean;
  isNew: boolean;
  canEdit: boolean;
  /** Persisted values (read mode renders these). */
  record: R;
  draft: R;
  saving: boolean;
  serverError: string | null;
  errors: Partial<Record<keyof R & string, string>>;
  dirtyFields: DirtyField<R>[];
  dirtyCount: number;
  status: EditStatus;
  confirm: ConfirmState;
  startEdit: () => void;
  setValue: (key: keyof R & string, value: FieldValue) => void;
  validateField: (key: keyof R & string) => boolean;
  validateAll: () => boolean;
  save: () => Promise<boolean>;
  requestCancel: () => void;
  getField: (key: keyof R & string) => FieldBinding;
  /** Counts for a card head: errors/changes among `keys`. */
  countsFor: (keys: readonly string[]) => { errors: number; changed: number };
  focusField: (key: string) => void;
  fieldId: (key: string) => string;
}

function sameValue(a: FieldValue | undefined, b: FieldValue | undefined) {
  return a === b;
}

export function useEditMode<R extends EditRecord>(options: UseEditModeOptions<R>): EditModeApi<R> {
  const { record, schema, initialMode = "read", canEdit = true, idPrefix = "field", firstFieldKey } = options;

  // Latest-callback refs so the effects/handlers below never go stale
  // without re-subscribing listeners on every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [mode, setMode] = useState<EditModeName>(initialMode);
  const [baseline, setBaseline] = useState<R>(record);
  const [draft, setDraftState] = useState<R>(record);
  const setDraft = useCallback((next: R) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);
  const [errors, setErrors] = useState<Partial<Record<keyof R & string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmReason, setConfirmReason] = useState<"cancel" | "leave">("cancel");
  const pendingHrefRef = useRef<string | null>(null);
  const [committed, setCommitted] = useState(false);
  const draftRef = useRef<R>(record);

  const isEditing = mode !== "read";
  const isNew = mode === "new";

  // Re-sync with the server record (after router.refresh) while reading.
  const recordKey = JSON.stringify(record);
  useEffect(() => {
    if (mode === "read") {
      setBaseline(record);
      setDraft(record);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordKey]);

  const fieldId = useCallback((key: string) => `${idPrefix}-${key}`, [idPrefix]);

  const dirtyFields = useMemo<DirtyField<R>[]>(() => {
    const result: DirtyField<R>[] = [];
    for (const key of Object.keys(schema) as Array<keyof R & string>) {
      const rule = schema[key] as FieldRule<R>;
      if (!sameValue(draft[key], baseline[key])) {
        const old = baseline[key];
        result.push({
          key,
          label: rule.label,
          oldValue: old as FieldValue,
          newValue: draft[key] as FieldValue,
          oldText: rule.format ? rule.format(old, baseline) : typeof old === "boolean" ? (old ? "on" : "off") : String(old ?? ""),
        });
      }
    }
    return result;
  }, [draft, baseline, schema]);
  const dirtyCount = dirtyFields.length;

  const runValidate = useCallback(
    (key: keyof R & string, nextDraft: R): string | null => {
      const rule = schema[key] as FieldRule<R> | undefined;
      return rule?.validate?.(nextDraft[key], nextDraft) ?? null;
    },
    [schema],
  );

  const setFieldError = useCallback((key: keyof R & string, message: string | null) => {
    setErrors((prev) => {
      if (!message) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      if (prev[key] === message) return prev;
      return { ...prev, [key]: message };
    });
  }, []);

  const validateField = useCallback(
    (key: keyof R & string) => {
      const message = runValidate(key, draft);
      setFieldError(key, message);
      return !message;
    },
    [draft, runValidate, setFieldError],
  );

  const setValue = useCallback(
    (key: keyof R & string, value: FieldValue) => {
      const next = { ...draftRef.current, [key]: value } as R;
      setDraft(next);
      // Fields that already show an error re-validate on every change
      // (cross-field rules may depend on the one just edited).
      setErrors((prevErrors) => {
        const keys = Object.keys(prevErrors) as Array<keyof R & string>;
        if (keys.length === 0) return prevErrors;
        const updated = { ...prevErrors };
        let changed = false;
        for (const errorKey of keys) {
          const message = runValidate(errorKey, next);
          if (!message) {
            delete updated[errorKey];
            changed = true;
          } else if (updated[errorKey] !== message) {
            updated[errorKey] = message;
            changed = true;
          }
        }
        return changed ? updated : prevErrors;
      });
      setServerError(null);
    },
    [runValidate, setDraft],
  );

  const focusField = useCallback(
    (key: string) => {
      const element = document.getElementById(fieldId(key));
      if (element) {
        element.scrollIntoView({ block: "center", behavior: "smooth" });
        (element as HTMLElement).focus({ preventScroll: true });
      }
    },
    [fieldId],
  );

  const orderedErrors = useCallback(
    (errorMap: Partial<Record<keyof R & string, string>>) => {
      const keys = Object.keys(errorMap) as Array<keyof R & string>;
      return keys
        .map((key) => ({ key, element: typeof document === "undefined" ? null : document.getElementById(fieldId(key)) }))
        .sort((a, b) => {
          if (!a.element || !b.element) return 0;
          return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        })
        .map((entry) => entry.key);
    },
    [fieldId],
  );

  const validateAll = useCallback(() => {
    const next: Partial<Record<keyof R & string, string>> = {};
    for (const key of Object.keys(schema) as Array<keyof R & string>) {
      const message = runValidate(key, draft);
      if (message) next[key] = message;
    }
    setErrors(next);
    const ordered = orderedErrors(next);
    if (ordered[0]) {
      // Defer one frame so the error styling is in the DOM first.
      requestAnimationFrame(() => focusField(ordered[0] as string));
    }
    return ordered.length === 0;
  }, [draft, focusField, orderedErrors, runValidate, schema]);

  const save = useCallback(async () => {
    if (saving || !isEditing) return false;
    if (!validateAll()) return false;
    if (mode === "edit" && dirtyCount === 0) {
      // Nothing to persist — just leave edit mode.
      setMode("read");
      setServerError(null);
      return true;
    }
    setSaving(true);
    setServerError(null);
    let result: SaveResult<R>;
    try {
      result = await optionsRef.current.onSave(draft, dirtyFields);
    } catch {
      result = { ok: false, error: "the server did not respond" };
    }
    setSaving(false);
    if (!result.ok) {
      let hasFieldError = false;
      if (result.fieldErrors) {
        const mapped: Partial<Record<keyof R & string, string>> = {};
        for (const [key, message] of Object.entries(result.fieldErrors)) {
          if (message && key in schema) mapped[key as keyof R & string] = message;
        }
        if (Object.keys(mapped).length > 0) {
          hasFieldError = true;
          setErrors(mapped);
          const ordered = orderedErrors(mapped);
          requestAnimationFrame(() => ordered[0] && focusField(ordered[0]));
        }
      }
      if (!hasFieldError) setServerError(result.error ?? "something went wrong");
      return false;
    }
    setCommitted(true);
    setBaseline(draft);
    setErrors({});
    if (mode === "edit") {
      setMode("read");
      setCommitted(false);
    }
    optionsRef.current.onSaved?.(draft);
    return true;
  }, [dirtyCount, dirtyFields, draft, focusField, isEditing, mode, orderedErrors, saving, schema, validateAll]);

  const leaveEdit = useCallback(() => {
    setDraft(baseline);
    setErrors({});
    setServerError(null);
    setConfirmOpen(false);
    if (mode === "new") {
      setCommitted(true);
      optionsRef.current.onCancelNew?.();
      return;
    }
    setMode("read");
  }, [baseline, mode, setDraft]);

  const startEdit = useCallback(() => {
    if (!canEdit || mode !== "read") return;
    setDraft(baseline);
    setErrors({});
    setServerError(null);
    setCommitted(false);
    setMode("edit");
    if (firstFieldKey) {
      requestAnimationFrame(() => requestAnimationFrame(() => focusField(firstFieldKey)));
    }
  }, [baseline, canEdit, firstFieldKey, focusField, mode, setDraft]);

  const requestCancel = useCallback(() => {
    if (!isEditing || saving) return;
    if (dirtyCount > 0) {
      pendingHrefRef.current = null;
      setConfirmReason("cancel");
      setConfirmOpen(true);
      return;
    }
    leaveEdit();
  }, [dirtyCount, isEditing, leaveEdit, saving]);

  const keepEditing = useCallback(() => {
    pendingHrefRef.current = null;
    setConfirmOpen(false);
  }, []);

  const discard = useCallback(() => {
    const href = pendingHrefRef.current;
    pendingHrefRef.current = null;
    if (href) {
      setCommitted(true);
      setConfirmOpen(false);
      optionsRef.current.navigate?.(href);
      return;
    }
    leaveEdit();
  }, [leaveEdit]);

  // --- Guards & keyboard -------------------------------------------------
  const guardActive = isEditing && dirtyCount > 0 && !committed;

  useEffect(() => {
    if (!guardActive) return undefined;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      pendingHrefRef.current = `${url.pathname}${url.search}${url.hash}`;
      setConfirmReason("leave");
      setConfirmOpen(true);
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [guardActive]);

  useEffect(() => {
    if (!isEditing) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
        return;
      }
      if (event.key === "Escape" && !event.defaultPrevented) {
        // Let overlays that own Escape (command palette, menus) close first.
        if (document.querySelector(".ui-command-overlay, [data-web-menu-open='true']")) return;
        if (confirmOpen) {
          keepEditing();
          return;
        }
        requestCancel();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmOpen, isEditing, keepEditing, requestCancel, save]);

  // --- Derived API -------------------------------------------------------
  const errorList = useMemo(
    () =>
      (Object.keys(errors) as Array<keyof R & string>).map((key) => ({
        fieldId: fieldId(key),
        key,
        label: (schema[key] as FieldRule<R> | undefined)?.label ?? key,
      })),
    [errors, fieldId, schema],
  );

  const status = useMemo<EditStatus>(
    () => ({
      kind: mode === "new" ? "new" : "edit",
      changedCount: dirtyCount,
      errors: errorList,
      serverError,
    }),
    [dirtyCount, errorList, mode, serverError],
  );

  const getField = useCallback(
    (key: keyof R & string): FieldBinding => {
      const rule = schema[key] as FieldRule<R>;
      const dirty = dirtyFields.find((entry) => entry.key === key);
      const error = errors[key] ?? null;
      return {
        id: fieldId(key),
        key,
        label: rule.label,
        required: Boolean(rule.required),
        value: draft[key] as FieldValue,
        // "Changed" styling only on an existing record; on a new one every
        // typed field would be "changed", which is noise.
        changed: mode === "edit" && Boolean(dirty),
        wasText: dirty ? dirty.oldText : null,
        error,
        messageId: `${fieldId(key)}-message`,
        onChange: (value) => setValue(key, value),
        onBlur: () => {
          validateField(key);
        },
      };
    },
    [dirtyFields, draft, errors, fieldId, mode, schema, setValue, validateField],
  );

  const countsFor = useCallback(
    (keys: readonly string[]) => ({
      errors: keys.filter((key) => key in errors).length,
      changed: mode === "edit" ? keys.filter((key) => dirtyFields.some((entry) => entry.key === key)).length : 0,
    }),
    [dirtyFields, errors, mode],
  );

  return {
    mode,
    isEditing,
    isNew,
    canEdit,
    record: baseline,
    draft,
    saving,
    serverError,
    errors,
    dirtyFields,
    dirtyCount,
    status,
    confirm: {
      open: confirmOpen,
      reason: confirmReason,
      fieldCount: dirtyCount,
      keepEditing,
      discard,
    },
    startEdit,
    setValue,
    validateField,
    validateAll,
    save,
    requestCancel,
    getField,
    countsFor,
    focusField,
    fieldId,
  };
}
