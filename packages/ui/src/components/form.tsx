import type {
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
