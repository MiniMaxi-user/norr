import type { HTMLAttributes } from "react";
import { cx } from "../cx";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  name: string;
  size?: AvatarSize;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/**
 * Initials avatar — an accent-tinted circle standing in for a real photo
 * anywhere a compound row/cell needs a visual anchor next to a name (e.g. a
 * Clients list row) instead of plain text alone. Purely decorative — the
 * caller still renders the name as real text beside it, so this is
 * `aria-hidden` rather than handing screen readers a redundant two-letter
 * node.
 *
 * `size="lg"` (56px) is the "hero mark" variant used by `DetailHero` — a
 * rounded-square (not circular) serif-face mark, deliberately breaking from
 * `sm`/`md`'s sans-face circle for the editorial detail-page header. That's
 * an intentional divergence for the statement/hero context, not an
 * inconsistency to reconcile with `sm`/`md`.
 */
export function Avatar({ name, size, className, ...rest }: AvatarProps) {
  return (
    <span className={cx("ui-avatar", size && `ui-avatar-${size}`, className)} aria-hidden {...rest}>
      {getInitials(name)}
    </span>
  );
}
