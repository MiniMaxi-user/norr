"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@yourorg/ui";
import { setLastUsedView } from "@/lib/preferences/actions";

export type AssetsView = "list" | "map";

const VIEWS: Array<{ key: AssetsView; label: string }> = [
  { key: "list", label: "List" },
  { key: "map", label: "Map" },
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
 * NOTE for whoever builds the next module view-switcher (Planning, or a
 * later Clients kanban/calendar view): this component is intentionally
 * generic in shape but lives under `app/(app)/assets/**` per this task's
 * scope boundary. Consider promoting it (or an equivalent) into
 * `@yourorg/ui` or a cross-module `components/` location once a second
 * module needs the same switcher, instead of copy-pasting it — flagged
 * here rather than done in this pass since that's outside this task's file
 * scope.
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

  return (
    <div role="group" aria-label="Change view">
      {VIEWS.map((v) => (
        <Button
          key={v.key}
          type="button"
          variant={view === v.key ? "primary" : "outline"}
          size="sm"
          aria-pressed={view === v.key}
          onClick={() => selectView(v.key)}
        >
          {v.label}
        </Button>
      ))}
    </div>
  );
}
