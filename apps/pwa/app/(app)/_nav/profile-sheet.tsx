"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@yourorg/ui";
import { PwaNote, PwaStack, WebButton, WebCard } from "@yourorg/ui/web";
import { ChevronRight, LogOut } from "@yourorg/ui/icons";
import { getOpenClockPeriods } from "@/lib/offline/db";
import { logOutAction } from "@/lib/auth/actions";
import { StockSheet } from "./stock-sheet";
import { useFeatures } from "@/lib/features/use-features";
import { ProfilePhoto } from "./profile-photo";

export interface ProfileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fullName: string | null;
  avatarUrl: string | null;
  email: string;
  currentUserId: string;
  /** Drives this sheet's "Offline data" row (IMPLEMENTATION.md §6:
   * "sync-status"). Now sourced from `Topbar`'s own `navigator.onLine`
   * listener (product feedback, 2026-09-13) rather than Today's last
   * `/api/workitems/today` sync result — this sheet is reachable from
   * every screen now, not just Today, so it needs a source of truth that
   * doesn't depend on that one screen's own fetch. */
  isOnline: boolean;
}

/** Exported so the profile button trigger (`_nav/topbar.tsx`) renders the
 * exact same initials this sheet's own avatar does, rather than a second,
 * possibly-drifting reimplementation. */
export function initialsOf(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

// Kept in sync with apps/pwa/package.json's own "version" field — this app
// has no build-time version-injection pipeline yet, so it's a plain literal
// rather than something read from an env var at request time.
const APP_VERSION = "0.1.0";

/**
 * Profile bottom sheet (issue #170, IMPLEMENTATION.md §6) — hours this
 * week, sync status, app version, and the logout button (logout lives here,
 * NOT in the bottom bar, per the same section). A `Dialog size="sheet"`
 * (packages/ui, added for this issue) rather than a centered dialog.
 *
 * Moved into `_nav/` alongside `BottomBar` (product feedback, 2026-09-13 —
 * the profile avatar that opens this now lives in the always-visible
 * `Topbar`, not just the Today screen) — this file itself didn't need to
 * change, only where it lives, since `Topbar` needs the exact same
 * `initialsOf`/`ProfileSheet` pair `today-screen.tsx` used to own.
 *

 * "Hours this week" combines `/api/engineer/hours-this-week`'s real,
 * server-side sum of this engineer's own CLOSED `time_entries` with
 * whatever this device has locally clocked (open or closed
 * `clockPeriods`) that started this week but hasn't been synced anywhere
 * yet — see `lib/offline/db.ts`'s top doc comment on why local periods
 * never reach the server in this story. Recomputed the moment the sheet
 * opens (not kept continuously ticking) — a rough weekly total, not a
 * second live timer.
 */
export function ProfileSheet({ open, onOpenChange, fullName, email, avatarUrl, currentUserId, isOnline }: ProfileSheetProps) {
  const [weekMinutes, setWeekMinutes] = useState<number | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  // Issue #182's Stock drill-in — this sheet closes itself the moment it's
  // opened (see the row's own `onClick` below) rather than stacking two
  // `size="sheet"` dialogs at once, since no existing Profile sub-view in
  // this app does that.
  const [stockOpen, setStockOpen] = useState(false);
  // Issue #248: no Stock row/sheet when the Inventory module is off.
  const showStock = useFeatures().has("inventory");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      let serverMinutes = 0;
      try {
        const response = await fetch("/api/engineer/hours-this-week");
        if (response.ok) {
          const data = (await response.json()) as { minutes: number };
          serverMinutes = data.minutes;
        }
      } catch {
        // Offline — fall back to local-only minutes below, same "never a
        // bare error screen" reasoning as the Today list's own sync.
      }

      const now = Date.now();
      const weekStart = now - 7 * 24 * 60 * 60 * 1000; // rough "this week" window for local periods only
      const openPeriods = await getOpenClockPeriods(currentUserId);
      const localMs = openPeriods.reduce((sum, period) => {
        if (period.startedAt < weekStart) return sum;
        return sum + (now - period.startedAt);
      }, 0);

      if (!cancelled) setWeekMinutes(serverMinutes + Math.round(localMs / 60000));
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, currentUserId]);

  async function handleLogOut() {
    setLoggingOut(true);
    // `logOutAction` itself calls `redirect("/login")` — invoked directly
    // (not via a `<form action>`) it still navigates correctly, Next
    // handles a `redirect()` thrown from a Server Action the same way
    // either call shape reaches it. Nothing meaningful runs after this
    // line on success.
    await logOutAction();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} size="sheet">
        <Dialog.Body>
          <div className="ui-dialog-sheet-handle" />
          <PwaStack>
            <div className="pwa-sheet-profile">
              <span aria-hidden className="pwa-sheet-avatar">
                <ProfilePhoto avatarUrl={avatarUrl} fullName={fullName} email={email} />
              </span>
              <div>
                <p className="pwa-sheet-name">{fullName || email}</p>
                <PwaNote>Service engineer · Norr</PwaNote>
              </div>
            </div>

            <WebCard size="touch" title="Account">
              <SheetRow label="This week" value={weekMinutes === null ? "…" : formatWeekMinutes(weekMinutes)} />
              {showStock && (
                <SheetNavRow
                  label="Stock"
                  onClick={() => {
                    onOpenChange(false);
                    setStockOpen(true);
                  }}
                />
              )}
              <SheetRow
                label="Offline data"
                value={isOnline ? "Synced" : "Not synced"}
                valueTone={isOnline ? "success" : "danger"}
              />
              <SheetRow label="Version" value={APP_VERSION} muted />
            </WebCard>

            <WebButton size="touch" block disabled={loggingOut} onClick={() => void handleLogOut()}>
              <LogOut aria-hidden />
              {loggingOut ? "Logging out…" : "Log out"}
            </WebButton>
          </PwaStack>
        </Dialog.Body>
      </Dialog>

      {showStock && <StockSheet open={stockOpen} onOpenChange={setStockOpen} currentUserId={currentUserId} />}
    </>
  );
}

function formatWeekMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `${hours}h ${String(remaining).padStart(2, "0")}m`;
}

function SheetRow({
  label,
  value,
  valueTone,
  muted,
}: {
  label: string;
  value: string;
  valueTone?: "success" | "danger";
  muted?: boolean;
}) {
  return (
    <div className="pwa-sheet-row">
      <span className="pwa-sheet-row-label">{label}</span>
      <span className="pwa-sheet-row-value" data-tone={valueTone} data-muted={muted ? "true" : undefined}>
        {value}
      </span>
    </div>
  );
}

/** Same visual row shape as `SheetRow` above, but a tappable drill-in into a
 * dedicated sub-view (issue #182's Stock row) rather than a plain
 * label/value display — a chevron replaces the value, matching the "this
 * row navigates somewhere" convention. */
function SheetNavRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="pwa-sheet-row">
      <span>{label}</span>
      <ChevronRight aria-hidden className="pwa-sheet-chevron" />
    </button>
  );
}
