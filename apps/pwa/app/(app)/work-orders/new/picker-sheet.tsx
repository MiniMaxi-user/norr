"use client";

import type { ReactNode } from "react";
import { Callout, Dialog, EmptyState, IconButton, Input, Skeleton } from "@yourorg/ui";
import { PwaNote, PwaStack } from "@yourorg/ui/web";
import { AlertTriangle, Search, X } from "@yourorg/ui/icons";
import type { RemoteStatus } from "./use-remote-list";

export interface PickerRow {
  id: string;
  title: string;
  sub?: string | null;
}

/**
 * Bottom-sheet single-select list (issue #223) — same chrome as the article
 * catalog sheet. Presentational: the parent owns fetching/debouncing and
 * passes `items` + `status`; passing `query`/`onQueryChange` shows a search
 * box. `hint` replaces the list while there is nothing to search yet (e.g.
 * "Type at least 2 characters").
 */
export function PickerSheet({
  open,
  onOpenChange,
  title,
  rows,
  status,
  onSelect,
  query,
  onQueryChange,
  searchPlaceholder,
  hint,
  emptyText,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  rows: PickerRow[];
  status: RemoteStatus;
  onSelect: (id: string) => void;
  query?: string;
  onQueryChange?: (value: string) => void;
  searchPlaceholder?: string;
  hint?: ReactNode;
  emptyText: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sheet">
      <Dialog.Header>
        <div className="ui-dialog-sheet-handle" />
        <p className="pwa-sheet-title">{title}</p>
        <IconButton variant="ghost" aria-label="Close" onClick={() => onOpenChange(false)}>
          <X aria-hidden />
        </IconButton>
      </Dialog.Header>
      <Dialog.Body>
        <PwaStack>
          {onQueryChange && (
            <Input
              type="search"
              autoFocus
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder ?? title}
              value={query ?? ""}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          )}

          {hint ? (
            <PwaNote>{hint}</PwaNote>
          ) : status === "error" ? (
            <Callout icon={AlertTriangle}>Couldn&apos;t load this list. Check your connection and try again.</Callout>
          ) : status === "loading" || status === "idle" ? (
            <PwaStack gap="sm">
              <Skeleton height={56} />
              <Skeleton height={56} />
              <Skeleton height={56} />
            </PwaStack>
          ) : rows.length === 0 ? (
            <EmptyState icon={<Search />} heading={emptyText} />
          ) : (
            <div className="pwa-pick-list">
              {rows.map((row) => (
                <button key={row.id} type="button" className="pwa-pick-row" onClick={() => onSelect(row.id)}>
                  <span className="pwa-list-main">
                    <span className="pwa-list-title">{row.title}</span>
                    {row.sub && <span className="pwa-list-ref">{row.sub}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </PwaStack>
      </Dialog.Body>
    </Dialog>
  );
}
