"use client";

// Local building blocks for the small create/edit/delete dialogs of the list
// and tree type settings pages (design system, issue #222). The agreed
// sub-entity pattern is a small dialog (`Dialog` + the `web-dialog-*` /
// `web-field-*` classes, like the converted contract line item dialog); these
// helpers keep the ~12 settings dialogs from repeating that markup.

import { useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Dialog, useEscapeToClose } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { WebConfirmDialog } from "@yourorg/ui/web-client";

export interface DialogFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <WebButton type="submit" variant="save" loading={pending}>
      {label}
    </WebButton>
  );
}

export function DialogError({ children }: { children: ReactNode }) {
  return (
    <p className="web-dialog-error" role="alert">
      <span className="web-error-mark" aria-hidden="true">
        !
      </span>
      {children}
    </p>
  );
}

export interface SettingsFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  /** The `useActionState` form action. */
  formAction: (formData: FormData) => void;
  error?: string;
  children: ReactNode;
}

/** Small dialog with a form: title, fields, Cancel + gold Save. */
export function SettingsFormDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  formAction,
  error,
  children,
}: SettingsFormDialogProps) {
  // The shared Dialog has no Escape handling of its own; the call site adds it.
  useEscapeToClose(open, onOpenChange);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <h2 className="web-dialog-title">{title}</h2>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <div className="web-dialog-form">
            {error ? <DialogError>{error}</DialogError> : null}
            {children}
          </div>
        </Dialog.Body>
        <Dialog.Footer>
          <WebButton onClick={() => onOpenChange(false)}>Cancel</WebButton>
          <SubmitButton label={submitLabel} />
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}

export interface DialogFieldProps {
  id: string;
  label: string;
  hint?: ReactNode;
  errors?: string[];
  children: ReactNode;
}

/** Label, control, optional hint and server field errors. */
export function DialogField({ id, label, hint, errors, children }: DialogFieldProps) {
  return (
    <div className="web-dialog-field">
      <label className="web-field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? <p className="web-rail-empty">{hint}</p> : null}
      {errors?.map((message) => (
        <p key={message} className="web-dialog-error" role="alert">
          {message}
        </p>
      ))}
    </div>
  );
}

export interface SettingsDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Explanatory text under the title. */
  children?: ReactNode;
  /** Runs the delete; resolves with the server's `error`, if any. */
  onConfirm: () => Promise<{ error?: string }>;
  /** Optional dependency check run whenever the dialog opens; its message
   * replaces `children`, its error is shown but does not block deleting. */
  checkDependencies?: () => Promise<{ message?: ReactNode; error?: string }>;
  checkingMessage?: string;
  /** Defaults to "Delete". */
  confirmLabel?: string;
  /** Runs after a successful delete, before the page refresh. */
  onDeleted?: () => void;
}

/** Delete confirmation (`WebConfirmDialog`, red confirm button) that runs the
 * action, shows its error inline and refreshes the page on success. */
export function SettingsDeleteDialog({
  open,
  onOpenChange,
  title,
  children,
  onConfirm,
  checkDependencies,
  checkingMessage = "Checking…",
  confirmLabel = "Delete",
  onDeleted,
}: SettingsDeleteDialogProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<{ loading: boolean; message?: ReactNode; error?: string }>({ loading: false });

  useEffect(() => {
    if (!open || !checkDependencies) return undefined;
    let cancelled = false;
    setCheck({ loading: true });
    void checkDependencies().then((result) => {
      if (!cancelled) setCheck({ loading: false, ...result });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function confirm() {
    setPending(true);
    setError(null);
    const result = await onConfirm();
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onDeleted?.();
    onOpenChange(false);
    router.refresh();
  }

  return (
    <WebConfirmDialog
      open={open}
      title={title}
      confirmLabel={confirmLabel}
      confirmVariant="danger"
      pending={pending}
      error={error ?? check.error ?? null}
      onCancel={() => {
        setError(null);
        onOpenChange(false);
      }}
      onConfirm={() => void confirm()}
    >
      {checkDependencies
        ? check.loading
          ? checkingMessage
          : (check.message ?? children ?? "This cannot be undone.")
        : (children ?? "This cannot be undone.")}
    </WebConfirmDialog>
  );
}
