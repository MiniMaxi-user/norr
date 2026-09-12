"use client";

import { useEffect, useState } from "react";
import { Button, Dialog, Inline, Label, RadioGroup, RadioGroupItem, Stack, Text, useTheme } from "@yourorg/ui";
import { LogOut, Moon, Sun } from "@yourorg/ui/icons";
import { getOpenClockPeriods } from "@/lib/offline/db";
import { logOutAction } from "@/lib/auth/actions";

export interface ProfileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fullName: string | null;
  email: string;
  currentUserId: string;
  /** Whether the last `/api/workitems/today` sync succeeded — reused as
   * this sheet's "Offline data" row (IMPLEMENTATION.md §6: "sync-status"),
   * same source of truth `today-screen.tsx` already tracks for its own
   * sync line. */
  isOnline: boolean;
}

/** Exported so the profile button trigger (`today-screen.tsx`) renders the
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
 * "Hours this week" combines `/api/engineer/hours-this-week`'s real,
 * server-side sum of this engineer's own CLOSED `time_entries` with
 * whatever this device has locally clocked (open or closed
 * `clockPeriods`) that started this week but hasn't been synced anywhere
 * yet — see `lib/offline/db.ts`'s top doc comment on why local periods
 * never reach the server in this story. Recomputed the moment the sheet
 * opens (not kept continuously ticking) — a rough weekly total, not a
 * second live timer.
 *
 * Also renders `AppearanceSection` (product feedback, 2026-09-12) — a
 * Light/Dark theme choice, same `@yourorg/ui` `ThemeProvider`/`useTheme`
 * (localStorage `norr-ui-theme`) the desktop app's own profile panel
 * already uses (`app/(app)/profile/profile-panel.tsx`'s own
 * `AppearanceSection`), just defaulting to dark here (`app/layout.tsx`)
 * instead of that app's `"system"`.
 */
export function ProfileSheet({ open, onOpenChange, fullName, email, currentUserId, isOnline }: ProfileSheetProps) {
  const [weekMinutes, setWeekMinutes] = useState<number | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

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
    <Dialog open={open} onOpenChange={onOpenChange} size="sheet">
      <Dialog.Body>
        <div className="ui-dialog-sheet-handle" />
        <Stack gap="md">
          <Inline gap="sm" align="center">
            <span
              aria-hidden
              style={{
                width: "3.375rem",
                height: "3.375rem",
                borderRadius: "var(--ui-radius-full)",
                background: "var(--ui-surface-hover)",
                border: "1px solid var(--ui-border)",
                color: "var(--ui-fg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 600,
                fontSize: "var(--ui-text-lg)",
                flexShrink: 0,
              }}
            >
              {initialsOf(fullName, email)}
            </span>
            <Stack gap="xs">
              <Text style={{ fontFamily: "var(--ui-font-serif)", fontSize: "var(--ui-text-xl)" }}>
                {fullName || email}
              </Text>
              <Text tone="muted">Service engineer · Norr</Text>
            </Stack>
          </Inline>

          <div
            style={{
              border: "1px solid var(--ui-border)",
              borderRadius: "var(--ui-radius-lg)",
              overflow: "hidden",
            }}
          >
            <SheetRow label="This week" value={weekMinutes === null ? "…" : formatWeekMinutes(weekMinutes)} />
            <SheetRow
              label="Offline data"
              value={isOnline ? "Synced" : "Not synced"}
              valueTone={isOnline ? "success" : "danger"}
            />
            <SheetRow label="Version" value={APP_VERSION} muted last />
          </div>

          <AppearanceSection />

          <Button variant="danger" fullWidth disabled={loggingOut} onClick={() => void handleLogOut()}>
            <Inline gap="xs" align="center" justify="center">
              <LogOut aria-hidden width={17} height={17} />
              {loggingOut ? "Logging out…" : "Log out"}
            </Inline>
          </Button>
        </Stack>
      </Dialog.Body>
    </Dialog>
  );
}

/** Light/Dark theme choice (product feedback, 2026-09-12) — mirrors the
 * desktop app's own `AppearanceSection`
 * (`app/(app)/profile/profile-panel.tsx`) almost exactly, minus a
 * "System" option: this app has no visible System radio there either
 * (its `ThemeProvider` supports it, the UI just never exposes it), and
 * `app/layout.tsx` already defaults this app to dark rather than
 * resolving a system preference on first load. */
function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div
      style={{
        border: "1px solid var(--ui-border)",
        borderRadius: "var(--ui-radius-lg)",
        padding: "0.875rem 1rem",
      }}
    >
      <Inline gap="xs" align="center" style={{ marginBottom: "0.625rem" }}>
        {isDark ? <Moon aria-hidden width={16} height={16} /> : <Sun aria-hidden width={16} height={16} />}
        <Text tone="muted">Appearance</Text>
      </Inline>
      <RadioGroup>
        <Stack gap="xs">
          <Label>
            <RadioGroupItem name="theme" checked={!isDark} onChange={() => setTheme("light")} /> Light
          </Label>
          <Label>
            <RadioGroupItem name="theme" checked={isDark} onChange={() => setTheme("dark")} /> Dark
          </Label>
        </Stack>
      </RadioGroup>
    </div>
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
  last,
}: {
  label: string;
  value: string;
  valueTone?: "success" | "danger";
  muted?: boolean;
  last?: boolean;
}) {
  return (
    <Inline
      justify="between"
      align="center"
      style={{
        padding: "0.875rem 1rem",
        borderBottom: last ? undefined : "1px solid var(--ui-surface-hover)",
      }}
    >
      <Text tone="muted">{label}</Text>
      <Text
        style={{
          fontWeight: muted ? undefined : 600,
          color: valueTone === "success" ? "var(--ui-success)" : valueTone === "danger" ? "var(--ui-danger)" : muted ? "var(--ui-muted-subtle)" : undefined,
        }}
      >
        {value}
      </Text>
    </Inline>
  );
}
