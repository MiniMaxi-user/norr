"use client";

import { useTransition } from "react";
import { Button } from "@yourorg/ui";
import { setLastUsedView } from "@/lib/preferences/actions";

export interface ViewOption<T extends string = string> {
  value: T;
  label: string;
}

/**
 * Generic list/kanban(/calendar/map) view switcher (docs/ARCHITECTURE.md
 * "View switcher per module"). Persists the choice through the existing
 * `PreferencesStore` seam (`lib/preferences/*`) exactly like the sidebar's
 * collapsed state (`components/shell/sidebar-shell.tsx`): the UI flips
 * instantly (optimistic — driven by the parent's own `value`/`onChange`
 * state) while the cookie write happens in the background via
 * `setLastUsedView(moduleKey, view)`, so switching views never waits on a
 * round trip, and the next full page load already remembers the choice
 * (read server-side via `preferencesStore.getLastUsedView`).
 *
 * There is nothing Clients-specific about this component — it's scoped
 * under `app/(app)/clients` only because of this task's file boundaries.
 * This is the "shared view-switcher pattern" docs/ARCHITECTURE.md calls
 * for; the next module that needs list/kanban/calendar/map switching
 * (Assets, Planning) should reuse this exact component rather than
 * re-implement view toggling — ideally after it's promoted to
 * `components/shell/` (flagged in the handoff, not done here since that
 * directory is outside this task's scope).
 */
export function ViewToggle<T extends string>({
  moduleKey,
  value,
  options,
  onChange,
}: {
  moduleKey: string;
  value: T;
  options: readonly ViewOption<T>[];
  onChange: (value: T) => void;
}) {
  const [, startTransition] = useTransition();

  function select(next: T) {
    if (next === value) return;
    onChange(next);
    startTransition(() => {
      void setLastUsedView(moduleKey, next);
    });
  }

  return (
    <span role="group" aria-label="Switch view">
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          variant={option.value === value ? "primary" : "outline"}
          size="sm"
          aria-pressed={option.value === value}
          onClick={() => select(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </span>
  );
}
