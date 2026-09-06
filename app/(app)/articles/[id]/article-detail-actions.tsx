"use client";

import { useEffect, useState } from "react";
import { DropdownMenu, IconButton } from "@yourorg/ui";
import { MoreVertical, Trash2 } from "@yourorg/ui/icons";
import type { ArticleRecord } from "../actions";
import { DeleteArticleDialog } from "../components/delete-article-dialog";

/**
 * Toolbar actions for the article detail page's hero — a single kebab menu
 * containing just Delete, same shape `ActivityDetailActions`
 * (`app/(app)/activities/[id]/activity-detail-actions.tsx`) establishes.
 * Renders nothing at all for a caller without `canDelete` — "hide, not
 * disable" convention, rather than an empty, useless kebab menu.
 */
export function ArticleDetailActions({ article, canDelete }: { article: ArticleRecord; canDelete: boolean }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

      {deleting && <DeleteArticleDialog article={article} open onOpenChange={setDeleting} redirectOnDelete />}
    </DropdownMenu>
  );
}
