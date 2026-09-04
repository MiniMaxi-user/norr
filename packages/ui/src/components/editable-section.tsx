import type { ReactNode } from "react";
import { cx } from "../cx";
import type { Icon } from "../icons";
import { Pencil } from "../icons";
import { Card } from "./card";
import { IconButton } from "./button";
import { SectionHeader } from "./section-header";
import { Stack } from "./stack";

export interface EditableSectionProps {
  icon: Icon;
  title: ReactNode;
  /** Opens this section's inline-edit state. Omitted entirely (never
   * disabled) for a caller without edit rights — same "never render an
   * affordance RLS would reject" convention `RelationCard.onEdit` already
   * documents. Also omitted while `editing` is already `true` (the pencil's
   * only job is to open edit state; closing happens via the edit content's
   * own Cancel/Save, not a second click on the same pencil). */
  onEdit?: () => void;
  editLabel?: string;
  editing: boolean;
  /** Read-only content — rendered inside a plain `Card` while `!editing`. */
  children?: ReactNode;
  /** Form content — rendered inside an accent-bordered `Card` while
   * `editing` (Cancel/Save actions are the caller's own, composed as part of
   * this content, since only the caller knows what a save actually commits). */
  editContent?: ReactNode;
  className?: string;
}

/**
 * A `SectionHeader` (icon + title + divider + pencil) that toggles between a
 * read-only `Card` and an accent-bordered inline-edit `Card` beneath it — the
 * Asset detail/edit screen's Equipment / Status & warranty / Notes sections
 * (asset new/edit design handoff v3), and any future record detail page that
 * wants the same "edit this one section in place, no separate popup or
 * page-wide form" shape instead of re-deriving the header+toggle+accent-card
 * chrome per caller.
 */
export function EditableSection({
  icon,
  title,
  onEdit,
  editLabel = "Edit",
  editing,
  children,
  editContent,
  className,
}: EditableSectionProps) {
  return (
    <Stack gap="sm" className={cx("ui-editable-section", className)}>
      <SectionHeader
        icon={icon}
        title={title}
        actions={
          !editing && onEdit ? (
            <IconButton variant="ghost" aria-label={editLabel} onClick={onEdit}>
              <Pencil />
            </IconButton>
          ) : undefined
        }
      />
      {editing ? <Card className="ui-editable-section-card-editing">{editContent}</Card> : <Card>{children}</Card>}
    </Stack>
  );
}
