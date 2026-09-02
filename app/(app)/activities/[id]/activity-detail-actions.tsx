"use client";

import { useEffect, useState } from "react";
import { DropdownMenu, IconButton } from "@yourorg/ui";
import { MoreVertical, Trash2 } from "@yourorg/ui/icons";
import type { ActivityRecord } from "../actions";
import { DeleteActivityDialog } from "../components/delete-activity-dialog";

/**
 * Toolbar actions for the activity detail page's hero — a single kebab menu
 * (`.design-handoff/melding_detail/README.md`) containing just Delete,
 * mirroring `components/shell/user-menu.tsx`'s
 * `Trigger`/`Content(open/onClose align="end")`/`Item` pattern exactly.
 * Replaces the old standalone danger "Delete" `Button` (issue #89) now that
 * the hero has no "Create work order" button to sit beside anymore (that
 * action moved into the "Linked work orders" section — issue #118).
 * Renders nothing at all for a caller without `canDelete` — same "hide, not
 * disable" convention as everywhere else on this page, rather than an empty,
 * useless kebab menu.
 */
export function ActivityDetailActions({ activity, canDelete }: { activity: ActivityRecord; canDelete: boolean }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Escape-to-close is the call site's own job per `DropdownMenu.Content`'s
  // doc comment — mirrors `components/shell/user-menu.tsx`'s identical
  // `keydown` effect, the one other `DropdownMenu` caller in this app.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!canDelete) return null;

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger>
        <IconButton
          variant="ghost"
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <MoreVertical />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content open={open} onClose={() => setOpen(false)} align="end">
        <DropdownMenu.Item
          icon={<Trash2 aria-hidden />}
          danger
          onClick={() => {
            setOpen(false);
            setDeleting(true);
          }}
        >
          Delete
        </DropdownMenu.Item>
      </DropdownMenu.Content>

      {deleting && <DeleteActivityDialog activity={activity} open onOpenChange={setDeleting} redirectOnDelete />}
    </DropdownMenu>
  );
}
