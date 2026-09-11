"use client";

import { useTransition } from "react";
import { ViewSwitcher, type ViewSwitcherOption } from "@yourorg/ui";
import { setLastUsedView } from "@/lib/preferences/actions";

export type ViewOption<T extends string = string> = ViewSwitcherOption<T>;

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
 * The actual pill-group rendering now lives in `@yourorg/ui`'s
 * `ViewSwitcher` (promoted alongside Assets' `assets-view-switcher.tsx`,
 * which had the near-identical copy this file used to carry) — this file
 * only keeps the `moduleKey`/`setLastUsedView` persistence wiring that's
 * still genuinely per-call-site.
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

  return <ViewSwitcher aria-label="Switch view" value={value} options={options} onChange={select} />;
}
