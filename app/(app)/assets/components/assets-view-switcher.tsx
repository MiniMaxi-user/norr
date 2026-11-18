"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { WebViewSwitcher } from "@yourorg/ui/web-client";
import { setLastUsedView } from "@/lib/preferences/actions";

export type AssetsView = "list" | "map";

const VIEWS = [
  { value: "list", label: "List" },
  { value: "map", label: "Map" },
] as const;

/**
 * List / Map switch in the Assets page header (docs/ARCHITECTURE.md "View
 * switcher per module"). The view lives in the URL (`?view=`, shareable) and
 * is persisted as the user's last-used view via `setLastUsedView("assets",
 * view)`, so the next visit to `/assets` opens the same one. The filters
 * (client, site, type, status, search) carry over to the other view; the
 * page and sort do not.
 */
export function AssetsViewSwitcher({ view }: { view: AssetsView }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  function select(next: string) {
    if (next === view || (next !== "list" && next !== "map")) return;
    const params = new URLSearchParams(window.location.search);
    params.set("view", next);
    params.delete("page");
    params.delete("sort");
    params.delete("dir");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
      void setLastUsedView("assets", next);
    });
  }

  return <WebViewSwitcher label="Switch view" options={VIEWS} value={view} onChange={select} />;
}
