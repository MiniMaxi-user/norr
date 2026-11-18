"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { WebViewSwitcher } from "@yourorg/ui/web-client";
import { setLastUsedView } from "@/lib/preferences/actions";

export type ClientsView = "list" | "kanban";

const VIEWS = [
  { value: "list", label: "List" },
  { value: "kanban", label: "Kanban" },
] as const;

/**
 * List / Kanban switch in the Clients page header. The view lives in the URL
 * (`?view=`) so the server fetches the right dataset (a page for the list,
 * the whole pipeline for the board) and the choice is shareable; it is also
 * persisted as the user's last-used view (`setLastUsedView`, the same
 * preference seam the sidebar uses) so the next visit opens the same one.
 * Switching drops the list's own filters (the board has its own).
 */
export function ClientsViewSwitcher({ view }: { view: ClientsView }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  function select(next: string) {
    if (next === view || (next !== "list" && next !== "kanban")) return;
    startTransition(() => {
      router.push(`${pathname}?view=${next}`);
      void setLastUsedView("clients", next);
    });
  }

  return <WebViewSwitcher label="Switch view" options={VIEWS} value={view} onChange={select} />;
}
