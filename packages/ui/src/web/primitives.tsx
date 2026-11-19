import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { cx } from "../cx";

/**
 * Web design-system primitives (issue #222): Badge, Button, Card, Breadcrumb,
 * DataTable. Hook-free and server-safe — everything interactive lives in
 * `./client.tsx`. Styling is `web.css` only (web app), never `styles.css`, so
 * the PWA's own `Badge`/`Button`/`Card` are untouched.
 */

/* ---------------------------------------------------------------------- *
 * Badge
 * ---------------------------------------------------------------------- */

/** On the dark page header, `warning` and `attention` both render filled gold
 * (something that needs attention: "3 open work orders", "No contract"). */
export type WebBadgeVariant = "success" | "warning" | "attention" | "danger" | "info" | "neutral" | "mono";

export interface WebBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: WebBadgeVariant;
}

/** 22px label for the page header — status, warning, classification, fact
 * or ID. Max 5 per header, enforced by `PageHeader`. */
export function WebBadge({ variant = "neutral", className, children, ...rest }: WebBadgeProps) {
  return (
    <span className={cx("web-badge", className)} data-variant={variant} {...rest}>
      {children}
    </span>
  );
}

/** Rounded status pill for a meaningful count as a value in a rail row
 * (`1 active` green, `3 open` gold, `2 overdue` red). Rail only — in cards
 * and tables status stays coloured text. */
export function WebStatusPill({
  tone,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone: "success" | "warning" | "danger" }) {
  return (
    <span className={cx("web-status-pill", className)} data-tone={tone} {...rest}>
      {children}
    </span>
  );
}

/** Key amount (potential, contract value, total) in serif 15px. At most 1–2
 * per card; ordinary amounts stay sans. */
export function WebAmount({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx("web-amount", className)} {...rest}>
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------- *
 * Button
 * ---------------------------------------------------------------------- */

/** secondary = white; primary = navy (max one per screen); save = gold
 * (edit/new mode, max one); danger = confirmation dialogs only. */
export type WebButtonVariant = "secondary" | "primary" | "save" | "danger";

interface WebButtonBase {
  variant?: WebButtonVariant;
  /** md = 32px (page header), filter = 30px (FilterBar add button), sm = 27px
   * (pagination, card heads). */
  size?: "md" | "filter" | "sm";
  /** Square, icon-only button — requires `aria-label`. */
  iconOnly?: boolean;
}

export interface WebButtonProps extends WebButtonBase, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  type?: "button" | "submit";
  /** Shows the spinner and disables the button (the only legitimate
   * disabled state — "Saving…"). */
  loading?: boolean;
}

export function WebButton({
  variant = "secondary",
  size = "md",
  iconOnly,
  loading,
  type = "button",
  className,
  disabled,
  children,
  ...rest
}: WebButtonProps) {
  return (
    <button
      type={type}
      className={cx("web-btn", className)}
      data-variant={variant}
      data-size={size}
      data-icon-only={iconOnly ? "true" : undefined}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span className="web-btn-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export interface WebLinkButtonProps
  extends WebButtonBase,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
}

/** Same look as `WebButton`, rendered as a real link (navigation, not an
 * action). */
export function WebLinkButton({
  href,
  variant = "secondary",
  size = "md",
  iconOnly,
  className,
  children,
  ...rest
}: WebLinkButtonProps) {
  return (
    <Link
      href={href}
      className={cx("web-btn", className)}
      data-variant={variant}
      data-size={size}
      data-icon-only={iconOnly ? "true" : undefined}
      {...rest}
    >
      {children}
    </Link>
  );
}

/* ---------------------------------------------------------------------- *
 * Card
 * ---------------------------------------------------------------------- */

export interface WebCardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  /** Mono 11px text right after the title ("3 · 1 open"). */
  meta?: ReactNode;
  /** Right side of the head: at most one link or two small buttons. Never a
   * pencil — editing happens through the page's single Edit button. */
  action?: ReactNode;
  /** Extra head content after the title/meta (validation counters). */
  headExtra?: ReactNode;
  /** Gives the body its own padding-less frame; the content decides (key/
   * value rows, a table, text). */
  children?: ReactNode;
}

/** White bordered card with a titled head. 1px border, 6px radius, no
 * shadow. Exactly one of three bodies goes inside: key/value rows, a table,
 * or running text (see docs: "02 Kaarten en indeling"). */
export function WebCard({ title, meta, action, headExtra, className, children, ...rest }: WebCardProps) {
  return (
    <section className={cx("web-card", className)} {...rest}>
      <header className="web-card-head">
        <h2 className="web-card-title">{title}</h2>
        {meta ? <span className="web-card-meta">{meta}</span> : null}
        {headExtra}
        {action ? <div className="web-card-action">{action}</div> : null}
      </header>
      <div className="web-card-body">{children}</div>
    </section>
  );
}

/** Wraps a list of cards on the main column: vertical gap 16px, capped so a
 * key/value column never exceeds 560px (two columns + gap). */
export function WebCardStack({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("web-card-stack", className)} {...rest}>
      {children}
    </div>
  );
}

/** Two separate, short cards side by side (e.g. Pipeline + Rate). */
export function WebCardPair({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("web-card-pair", className)} {...rest}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * Figure tiles — only for tabs that are about numbers (DS 02 "KPI tiles")
 * ---------------------------------------------------------------------- */

export interface WebFigure {
  label: string;
  /** Already formatted (serif 21px, tabular). */
  value: ReactNode;
  hint?: ReactNode;
}

/** A row of white bordered figure tiles. Never on Overview — only on a tab
 * whose subject is numbers (a work order's Hours tab). */
export function WebFigures({ items, className }: { items: WebFigure[]; className?: string }) {
  return (
    <div className={cx("web-figures", className)}>
      {items.map((item) => (
        <div key={item.label} className="web-figure">
          <div className="web-figure-label">{item.label}</div>
          <div className="web-figure-value">{item.value}</div>
          {item.hint ? <div className="web-figure-hint">{item.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * Breadcrumb
 * ---------------------------------------------------------------------- */

export interface WebBreadcrumbItem {
  label: string;
  href?: string;
  /** Renders in the mono face (record IDs). */
  mono?: boolean;
}

/** Every level but the last is a link; the last one (the record) is not. In
 * edit/new mode the caller appends a final "Edit" crumb with `editCrumb`. */
export function WebBreadcrumb({ items, editCrumb }: { items: WebBreadcrumbItem[]; editCrumb?: string }) {
  return (
    <nav className="web-breadcrumb" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => {
          const isLast = index === items.length - 1 && !editCrumb;
          return (
            <li key={`${item.label}-${index}`}>
              {item.href && !isLast ? (
                <Link href={item.href}>{item.label}</Link>
              ) : (
                <span data-mono={item.mono ? "true" : undefined} aria-current={isLast ? "page" : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
        {editCrumb ? (
          <li>
            <span data-edit-crumb="true" aria-current="page">
              {editCrumb}
            </span>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}

/* ---------------------------------------------------------------------- *
 * DataTable — a real <table> inside a card; status as coloured text.
 * ---------------------------------------------------------------------- */

export function WebDataTable({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cx("web-table", className)} {...rest}>
      {children}
    </table>
  );
}

export function WebDataTableEmpty({ children }: { children: ReactNode }) {
  return <p className="web-table-empty">{children}</p>;
}

/* ---------------------------------------------------------------------- *
 * Field — a labelled input row for a card that is not driven by `useEditMode`
 * (e.g. a separate "Change password" card).
 * ---------------------------------------------------------------------- */

export interface WebFieldProps {
  label: string;
  /** `id` of the control inside (wires the label). */
  htmlFor: string;
  required?: boolean;
  /** Message that says what is wrong and how to fix it. */
  error?: string | null;
  /** id of the message element, for `aria-describedby` on the control. */
  messageId?: string;
  children: ReactNode;
}

/** Same row as an edit-mode `KeyValueCard` field: label left, control right,
 * error line (with the "!" mark) under the control. */
export function WebField({ label, htmlFor, required, error, messageId, children }: WebFieldProps) {
  return (
    <div className="web-field" data-state={error ? "error" : "normal"} data-has-message={error ? "true" : undefined}>
      <label className="web-field-label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="web-field-required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <div className="web-field-control">{children}</div>
      {error ? (
        <div id={messageId} className="web-field-message">
          <span className="web-error-mark" aria-hidden="true">
            !
          </span>
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** The web text input (`web-input`). */
export const WebInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function WebInput(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx("web-input", className)} {...rest} />;
});
