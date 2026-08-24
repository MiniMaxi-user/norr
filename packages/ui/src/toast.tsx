"use client";
// Genuinely interactive (owns an imperative queue + auto-dismiss timers), so
// it's its own "use client" entry — same reasoning and physically-separate
// build entry as client.tsx/tabs.tsx, see tsup.config.ts's top-of-file
// comment for the full "why a sibling file, not inlined into index.ts" story.

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { cx } from "./cx";

export type ToastTone = "default" | "success" | "danger";

export interface ToastOptions {
  title?: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Auto-dismiss after this many ms. `0` disables auto-dismiss. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastEntry extends ToastOptions {
  id: string;
}

type Listener = () => void;

let toasts: ToastEntry[] = [];
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

function removeToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Queue a toast for display. Call from anywhere (event handler, server
 * action result handler, ...) — no hook required. */
export function toast(options: ToastOptions): string {
  const id = crypto.randomUUID();
  toasts = [...toasts, { id, tone: "default", duration: 5000, ...options }];
  emit();
  return id;
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return toasts;
}

/** Read the current toast queue reactively. */
export function useToast() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { toasts: list, toast, dismiss: removeToast };
}

function ToastItem({ id, title, description, tone, duration, action }: ToastEntry) {
  useEffect(() => {
    if (!duration) return undefined;
    const timer = setTimeout(() => removeToast(id), duration);
    return () => clearTimeout(timer);
  }, [id, duration]);

  return (
    <div className={cx("ui-toast", tone && tone !== "default" && `ui-toast-${tone}`)} role="status">
      <div className="ui-toast-body">
        {title ? <p className="ui-toast-title">{title}</p> : null}
        {description ? <p className="ui-toast-description">{description}</p> : null}
      </div>
      {action ? (
        <button type="button" className="ui-toast-action" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
      <button type="button" className="ui-toast-close" aria-label="Close" onClick={() => removeToast(id)}>
        <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export interface ToastProviderProps {
  children: ReactNode;
  /** Where toasts stack on screen. Defaults to bottom-right — pass to
   * override via CSS (e.g. `className="ui-toast-viewport-top-right"`). */
  className?: string;
}

/** Mount once near the app root. Renders a fixed stack and drains the toast
 * queue produced by calling `toast(...)` anywhere in the tree. */
export function ToastProvider({ children, className }: ToastProviderProps) {
  const { toasts: list } = useToast();

  return (
    <>
      {children}
      <div className={cx("ui-toast-viewport", className)}>
        {list.map((entry) => (
          <ToastItem key={entry.id} {...entry} />
        ))}
      </div>
    </>
  );
}
