"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ViewSwitcher, type ViewSwitcherOption } from "@yourorg/ui";
import { setLastUsedView } from "@/lib/preferences/actions";

export type AssetsView = "list" | "map";

const VIEWS: readonly ViewSwitcherOption<AssetsView>[] = [
  { value: "list", label: "List" },
  { value: "map", label: "Map" },
];

/**
 * Generic-shaped list/map view switcher for the Assets module (docs/
 * ARCHITECTURE.md "Premium UX requirements" — one shared pattern per
 * module, not reinvented). Persists the choice via
 * `lib/preferences/actions.ts` `setLastUsedView("assets", view)` (the
 * generic seam already added to `lib/preferences` — see
 * `PreferencesStore.setLastUsedView`) so the next visit to `/assets`
 * defaults back to whichever view was last used, and reflects the choice in
 * the URL (`?view=`) so it's shareable/bookmarkable and survives a
 * filter change without extra plumbing.
 *
 * The actual pill-group rendering now lives in `@yourorg/ui`'s
 * `ViewSwitcher` (promoted alongside Clients' `view-toggle.tsx`, which had
 * the near-identical copy this file used to carry) — this file only keeps
 * the Assets-specific URL/`setLastUsedView` wiring.
 */
export function AssetsViewSwitcher({ view }: { view: AssetsView }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function selectView(next: AssetsView) {
    if (next === view) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
    startTransition(() => {
      void setLastUsedView("assets", next);
    });
  }

  return <ViewSwitcher aria-label="Change view" value={view} options={VIEWS} onChange={selectView} />;
}
