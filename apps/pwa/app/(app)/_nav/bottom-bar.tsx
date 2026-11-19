"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Boxes, Camera, CalendarDays, ClipboardList, Clock, Home, Signature, type Icon } from "@yourorg/ui/icons";

/**
 * The field PWA's whole primary nav (issue #170, IMPLEMENTATION.md §3;
 * restyled to the "EAM Console" PwaNav, issue #222) — mounted once in
 * `app/(app)/layout.tsx`, not per-page, so both `/today` and
 * `/work-orders/[id]` share one instance.
 *
 * Zone A ("Today") is always rendered, everywhere under `(app)` — fixed on
 * the left, never scrolls. Not active: a white circle with a navy border and
 * navy label; active (only on `/today`): gold. Zone B (the work-order section
 * steps) only renders AT ALL while a `/work-orders/[id]` route is active — per
 * §3, "Rendert uitsluitend als er een werkorder open is [...] Geen disabled
 * tabs": on `/today` this slot shows one line of plain help text instead of
 * grayed-out targets, since there is nothing to navigate to yet. The steps
 * scroll horizontally (70px each); a white fade shows on the side where more
 * steps are, and the active step scrolls into view.
 *
 * Zone B's step state is a pure function of `activeIndex` (the open
 * section's position in `WORK_ORDER_SECTIONS`), not persisted history: steps
 * before the active one are "done" (green), the active one gold, steps after
 * it plain grey. Selecting an earlier step therefore un-greens everything
 * past it automatically — no extra state to reset. The 2px connecting line is
 * green up to the active step and `border-default` after it (no gradient).
 *
 * `usePathname()`/`useSearchParams()` (not props) is deliberate — this is a
 * shared layout-level nav, so it derives "which work order, which section"
 * straight from the URL rather than requiring every page under it to thread
 * that state down through props/context.
 */
const WORK_ORDER_SECTIONS: { value: string; label: string; icon: Icon }[] = [
  { value: "home", label: "Home", icon: Home },
  { value: "work", label: "Work", icon: ClipboardList },
  { value: "hours", label: "Hours", icon: Clock },
  { value: "articles", label: "Articles", icon: Boxes },
  { value: "photos", label: "Photos", icon: Camera },
  { value: "sign", label: "Sign", icon: Signature },
];

export function BottomBar() {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();

  // `/work-orders/new` (issue #223) is the create screen, not an open work order.
  const workOrderMatch = /^\/work-orders\/(?!new(?:\/|$))([^/]+)/.exec(pathname);
  const workOrderId = workOrderMatch?.[1] ?? null;
  const activeSection = searchParams.get("section") ?? "home";
  const isToday = pathname === "/today";
  const activeIndex = WORK_ORDER_SECTIONS.findIndex((section) => section.value === activeSection);
  const doneCount = Math.max(activeIndex, 0);

  // Presentation only: which side of the step strip has more steps to scroll
  // to (drives the white fades), and bringing the active step into view.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ start: false, end: false });

  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setFade({
      start: el.scrollLeft > 1,
      end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) {
      const left = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
      el.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    }
    updateFade();
  }, [workOrderId, activeIndex, updateFade]);

  return (
    <nav className="pwa-nav" aria-label="Primary">
      <div className="pwa-nav-today-slot">
        <Link
          href="/today"
          className="pwa-nav-item"
          data-today="true"
          aria-current={isToday ? "page" : undefined}
        >
          <span className="pwa-nav-circle">
            <CalendarDays aria-hidden />
          </span>
          <span className="pwa-nav-label">Today</span>
        </Link>
      </div>
      <span className="pwa-nav-divider" aria-hidden />

      {workOrderId ? (
        <div className="pwa-nav-steps">
          <div
            ref={scrollRef}
            className="pwa-nav-scroll"
            role="tablist"
            aria-label="Work order sections"
            onScroll={updateFade}
          >
            <div
              className="pwa-nav-track"
              // Number of done steps drives the green part of the connecting line.
              style={{ ["--pwa-nav-done" as string]: doneCount }}
            >
              <span className="pwa-nav-line" aria-hidden />
              <span className="pwa-nav-line-done" aria-hidden />
              {WORK_ORDER_SECTIONS.map((section, index) => {
                const Icon = section.icon;
                const active = index === activeIndex;
                const done = !active && index < activeIndex;
                return (
                  <Link
                    key={section.value}
                    href={`/work-orders/${workOrderId}?section=${section.value}`}
                    scroll={false}
                    role="tab"
                    aria-selected={active}
                    aria-current={active ? "page" : undefined}
                    className="pwa-nav-item"
                    data-state={active ? "active" : done ? "done" : "todo"}
                  >
                    <span className="pwa-nav-circle">
                      <Icon aria-hidden />
                    </span>
                    <span className="pwa-nav-label">{section.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
          <span className="pwa-nav-fade" data-side="start" data-visible={fade.start} aria-hidden />
          <span className="pwa-nav-fade" data-side="end" data-visible={fade.end} aria-hidden />
        </div>
      ) : (
        <p className="pwa-nav-hint">Open a work order for hours, articles, photos &amp; sign off</p>
      )}
    </nav>
  );
}
