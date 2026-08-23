import type {
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "../cx";

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  children?: ReactNode;
}

export function Label({ className, children, ...rest }: LabelProps) {
  return (
    <label className={cx("ui-label", className)} {...rest}>
      {children}
    </label>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...rest }: InputProps) {
  return <input className={cx("ui-input", className)} {...rest} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children?: ReactNode;
}

/** Native-backed `<select>`, styled to match `Input`, with a decorative
 * chevron. Pass `<option>` elements as `children`, same as plain HTML. */
export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <div className="ui-select-wrap">
      <select className={cx("ui-select", className)} {...rest}>
        {children}
      </select>
      <svg
        className="ui-select-caret"
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Same styling contract as `Input`, for multi-line text. */
export function Textarea({ className, ...rest }: TextareaProps) {
  return <textarea className={cx("ui-textarea", className)} {...rest} />;
}

export interface FormSectionProps extends HTMLAttributes<HTMLDivElement> {
  /** Short eyebrow-style section label, e.g. "Contact", "Address". */
  title: string;
  description?: ReactNode;
  /** Small decorative icon rendered in a tinted chip beside the title —
   * optional, purely visual (see icons.tsx for the icon set). */
  icon?: ReactNode;
  children?: ReactNode;
}

/**
 * Groups related fields under a labeled section — the structural fix for
 * "this form is one undifferentiated flat list of fields" (the specific
 * product feedback on `client-form-dialog.tsx`/`site-form-dialog.tsx`).
 * Stack several inside a dialog body instead of one long unbroken `Stack`
 * of `FormField`s; a divider renders automatically between consecutive
 * sections (see `.ui-form-section + .ui-form-section` in styles.css).
 */
export function FormSection({ title, description, icon, className, children, ...rest }: FormSectionProps) {
  return (
    <div className={cx("ui-form-section", className)} {...rest}>
      <div className="ui-form-section-header">
        {icon && <span className="ui-form-section-icon">{icon}</span>}
        <div className="ui-form-section-titles">
          <span className="ui-form-section-title">{title}</span>
          {description && <span className="ui-form-section-description">{description}</span>}
        </div>
      </div>
      <div className="ui-form-section-body">{children}</div>
    </div>
  );
}

export interface FormGridProps extends HTMLAttributes<HTMLDivElement> {
  /** Number of equal-width columns at normal dialog widths — collapses to
   * a single column below `styles.css`'s narrow-dialog breakpoint. */
  columns?: 2 | 3;
  children?: ReactNode;
}

/**
 * Two/three-column field layout for naturally-paired fields (postal code +
 * city, latitude + longitude, ...) instead of every field stacking full
 * width regardless of how short its content is. Children are direct grid
 * items — wrap one in `FormGridFull` to span every column (e.g. a field
 * that follows a paired row but doesn't have a natural partner).
 */
export function FormGrid({ columns = 2, className, children, ...rest }: FormGridProps) {
  return (
    <div className={cx("ui-form-grid", columns === 3 && "ui-form-grid-3", className)} {...rest}>
      {children}
    </div>
  );
}

export interface FormGridFullProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/** Spans every column of the nearest `FormGrid` — see `FormGrid` above. */
export function FormGridFull({ className, children, ...rest }: FormGridFullProps) {
  return (
    <div className={cx("ui-form-grid-full", className)} {...rest}>
      {children}
    </div>
  );
}
