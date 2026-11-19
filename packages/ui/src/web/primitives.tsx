import { forwardRef, type AnchorHTMLAttributes, type CSSProperties, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
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

/** `web` = the desktop size (22px); `touch` = the field PWA (24px, 12.5px) —
 * one component, two sizes (DS README: never a copy per app). */
export type WebSize = "web" | "touch";

export interface WebBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: WebBadgeVariant;
  size?: WebSize;
}

/** 22px label for the page header — status, warning, classification, fact
 * or ID. Max 5 per header, enforced by `PageHeader`. */
export function WebBadge({ variant = "neutral", size = "web", className, children, ...rest }: WebBadgeProps) {
  return (
    <span className={cx("web-badge", className)} data-variant={variant} data-size={size === "touch" ? "touch" : undefined} {...rest}>
      {children}
    </span>
  );
}

export type WebStatusTone = "success" | "warning" | "danger" | "info" | "neutral";

/** Maps a reference-list colour name (`reference_list_items.color`) to a
 * design-system tone. Unknown/empty colours read as plain text. Server-safe
 * (also re-exported from `@yourorg/ui/web-client`). */
export function toneFromColor(color: string | null | undefined): WebStatusTone {
  switch ((color ?? "").toLowerCase()) {
    case "green":
    case "success":
    case "emerald":
      return "success";
    case "amber":
    case "yellow":
    case "orange":
    case "warning":
    case "gold":
      return "warning";
    case "red":
    case "danger":
    case "rose":
      return "danger";
    case "blue":
    case "teal":
    case "cyan":
    case "info":
    case "sky":
      return "info";
    default:
      return "neutral";
  }
}

/** Base colour of an activity type (DS Planning 07 section 4, PWA 08). The
 * colour comes from the type item itself (Settings > Activity types, a named
 * palette value or a hex code) — never from the type's name. Named values map
 * to the design system's seed tones; an explicit hex code is used as-is. */
const TYPE_TONE_HEX: Record<WebStatusTone, string> = {
  danger: "#b2503f",
  success: "#4f8a4a",
  info: "#0f6d80",
  warning: "#8a6522",
  neutral: "#61716b",
};

export function typeBaseColor(color: string | null | undefined): string {
  const trimmed = (color ?? "").trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return trimmed;
  return TYPE_TONE_HEX[toneFromColor(trimmed)];
}

/** Inline style that feeds the `--type-color` custom property. */
export function typeColorStyle(color: string | null | undefined): CSSProperties {
  return { ["--type-color" as string]: typeBaseColor(color) } as CSSProperties;
}

/** Soft round pill in the activity type's own colour (`reference_list_items
 * .color`); calm grey when the type has no colour. Used in the PWA's Today
 * cards and work-order header (`size="touch"`). */
export function WebTypeBadge({
  color,
  size = "web",
  className,
  style,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLSpanElement>, "color"> & { color?: string | null; size?: WebSize }) {
  return (
    <span
      className={cx("web-type-badge", className)}
      data-size={size === "touch" ? "touch" : undefined}
      style={{ ...typeColorStyle(color), ...style }}
      {...rest}
    >
      {children}
    </span>
  );
}

/** Soft round status badge on light surfaces — only for what matters: a
 * meaningful count in the rail (`1 active`, `3 open`), a deviating status in
 * a table row (`In repair`), a notable status/setting in a key/value row
 * (`Lead`, `Off · default`). Ordinary values stay text. Max one per row.
 * Size: `rail` (default, 20px), `table` (20px, 11px), `kv` (22px). */
export function WebStatusBadge({
  tone,
  size = "rail",
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone: WebStatusTone; size?: "rail" | "table" | "kv" | "touch" }) {
  return (
    <span className={cx("web-status-badge", className)} data-tone={tone} data-size={size} {...rest}>
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
  size?: "md" | "filter" | "sm" | "touch";
  /** Square, icon-only button — requires `aria-label`. */
  iconOnly?: boolean;
  /** Full-width block button (cards, action bars). */
  block?: boolean;
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
  block,
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
      data-block={block ? "true" : undefined}
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
  block,
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
      data-block={block ? "true" : undefined}
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
  /** `touch` = the field PWA's card (8px radius, 16px padding, 15px title). */
  size?: WebSize;
  /** Gives the body its own padding-less frame; the content decides (key/
   * value rows, a table, text). */
  children?: ReactNode;
}

/** White bordered card with a titled head. 1px border, 6px radius, no
 * shadow. Exactly one of three bodies goes inside: key/value rows, a table,
 * or running text (see docs: "02 Kaarten en indeling"). */
export function WebCard({ title, meta, action, headExtra, size = "web", className, children, ...rest }: WebCardProps) {
  return (
    <section className={cx("web-card", className)} data-size={size === "touch" ? "touch" : undefined} {...rest}>
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
