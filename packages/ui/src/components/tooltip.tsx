import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

export interface TooltipProps {
  content?: ReactNode;
  children: ReactElement<{ title?: string }>;
}

/**
 * Lightweight, CSS-only tooltip (no JS positioning library, no portal —
 * `::after` + `:hover`/`:focus-within`, matching this design system's
 * "plain CSS, no dependency" approach). Also sets the native `title`
 * attribute (when `content` is a plain string) so assistive tech and the
 * browser's own fallback both get the same information even before/without
 * the CSS bubble.
 */
export function Tooltip({ content, children }: TooltipProps) {
  if (!content) return children;
  const label = typeof content === "string" ? content : undefined;

  const child = isValidElement(children) ? cloneElement(children, label ? { title: label } : {}) : children;

  return (
    <span className="ui-tooltip" data-tooltip={label}>
      {child}
    </span>
  );
}
