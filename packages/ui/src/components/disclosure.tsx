import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export interface DisclosureProps extends Omit<HTMLAttributes<HTMLDetailsElement>, "children" | "title"> {
  /** Uncontrolled initial open state — native `<details>` semantics, no
   * React state involved. */
  defaultOpen?: boolean;
  children?: ReactNode;
}

/**
 * Disclosure — a plain, presentational collapsible section for grouped/
 * nested list layouts (e.g. "site -> its assets" on the Clients detail
 * page), backed by native `<details>`/`<summary>` rather than React state.
 * Unlike `Tabs`, this needs no "use client" boundary at all — the browser
 * owns open/closed — so it's safe to compose straight into a Server
 * Component tree (a list of `Disclosure`s rendered from an `async function`
 * page, no client wrapper required just to group content).
 *
 * ```tsx
 * <Disclosure defaultOpen>
 *   <Disclosure.Summary meta={<Badge>3 assets</Badge>}>Warehouse A</Disclosure.Summary>
 *   <Disclosure.Content>...</Disclosure.Content>
 * </Disclosure>
 * ```
 */
export function Disclosure({ defaultOpen, className, children, ...rest }: DisclosureProps) {
  return (
    <details className={cx("ui-disclosure", className)} open={defaultOpen} {...rest}>
      {children}
    </details>
  );
}

export interface DisclosureSummaryProps {
  children?: ReactNode;
  /** Optional trailing content (e.g. a count `Badge`) rendered at the end of
   * the summary row, opposite the label + chevron. */
  meta?: ReactNode;
}

function DisclosureSummary({ children, meta }: DisclosureSummaryProps) {
  return (
    <summary className="ui-disclosure-summary">
      <svg
        className="ui-disclosure-chevron"
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <path d="M9.5 4.5 17 12l-7.5 7.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="ui-disclosure-summary-label">{children}</span>
      {meta && <span className="ui-disclosure-summary-meta">{meta}</span>}
    </summary>
  );
}

export interface DisclosureContentProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

function DisclosureContent({ className, children, ...rest }: DisclosureContentProps) {
  return (
    <div className={cx("ui-disclosure-content", className)} {...rest}>
      {children}
    </div>
  );
}

Disclosure.Summary = DisclosureSummary;
Disclosure.Content = DisclosureContent;
