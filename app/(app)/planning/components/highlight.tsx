import type { ReactNode } from "react";

/** Wraps case-insensitive matches of `query` in `<mark>` (header search
 * highlights hits in the grid and the backlog). Returns the plain text when
 * there is no query or no match. */
export function highlight(text: string, query: string): ReactNode {
  const needle = query.trim().toLowerCase();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const first = lower.indexOf(needle);
  if (first === -1) return text;

  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = first;
  while (index !== -1) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(
      <mark key={index} className="web-plan-mark">
        {text.slice(index, index + needle.length)}
      </mark>,
    );
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
