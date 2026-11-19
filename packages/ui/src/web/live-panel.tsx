"use client";
// LivePanel of the web design system (issue #222): the one conspicuous block at
// the very top of a detail page's rail for something happening NOW — a running
// timer, a hard deadline that is close or past, or an action only the current
// user can take. Each detail page supplies a `getLivePanel(record, user)` that
// returns a `LivePanelData` or `null`; when in doubt it returns `null`.

import { useEffect, useState } from "react";
import Link from "next/link";

export type LivePanelVariant = "attention" | "urgent" | "info";

export interface LivePanelAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface LivePanelData {
  /** attention = running / needs you (warning colours); urgent = overdue;
   * info = a calm field status (scheduled), teal. */
  variant: LivePanelVariant;
  /** Overline: "RUNNING TIMER", "SLA EXPIRES", "ACTION NEEDED FROM YOU". */
  title: string;
  /** Main value (serif 26px). A string is shown as is; `{ since }` counts up
   * and `{ until }` counts down every second (ISO timestamps). */
  value: string | { since: string } | { until: string };
  /** One line of context. */
  context: string;
  /** One or two actions; the first is the gold primary one. */
  actions: LivePanelAction[];
  /** Other things going on, shown as one line `+ 1 other: …` that swaps the
   * panel. */
  others?: LivePanelData[];
}

function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function LivePanelBody({ panel, onSwap }: { panel: LivePanelData; onSwap: (index: number) => void }) {
  const ticking = typeof panel.value !== "string";
  const now = useNow(ticking);
  let text: string;
  let variant = panel.variant;
  if (typeof panel.value === "string") text = panel.value;
  else if ("since" in panel.value) text = formatClock((now - new Date(panel.value.since).getTime()) / 1000);
  else {
    const remaining = (new Date(panel.value.until).getTime() - now) / 1000;
    if (remaining <= 0) variant = "urgent";
    text = remaining <= 0 ? "Expired" : `${formatClock(remaining)} left`;
  }
  const others = panel.others ?? [];

  return (
    <>
      <div className="web-live" data-variant={variant}>
        {/* Screen readers hear the change to "urgent", not every second. */}
        <div className="web-live-value" aria-live={variant === "urgent" ? "polite" : "off"}>
          {text}
        </div>
        <div className="web-live-context">{panel.context}</div>
        {panel.actions.length > 0 ? (
          <div className="web-live-actions">
            {panel.actions.slice(0, 2).map((action, index) =>
              action.href ? (
                <Link key={action.label} href={action.href} className="web-live-button" data-primary={index === 0 ? "true" : undefined}>
                  {action.label}
                </Link>
              ) : (
                <button
                  key={action.label}
                  type="button"
                  className="web-live-button"
                  data-primary={index === 0 ? "true" : undefined}
                  onClick={action.onClick}
                >
                  {action.label}
                </button>
              ),
            )}
          </div>
        ) : null}
      </div>
      {others.length > 0 ? (
        <button type="button" className="web-rail-link web-live-others" onClick={() => onSwap(0)}>
          + {others.length} other{others.length === 1 ? "" : "s"}: {others[0]!.title.toLowerCase()}
        </button>
      ) : null}
    </>
  );
}

/** Max one per page, always the first rail section. Renders nothing for
 * `null`. */
export function LivePanel({ panel }: { panel: LivePanelData | null }) {
  const [current, setCurrent] = useState<LivePanelData | null>(panel);
  useEffect(() => setCurrent(panel), [panel]);
  if (!current) return null;
  return (
    <section className="web-rail-section" aria-label={current.title}>
      <div className="web-rail-section-head">
        <h2 className="web-overline">{current.title}</h2>
      </div>
      <LivePanelBody
        panel={current}
        onSwap={(index) => {
          const next = current.others?.[index];
          if (next) setCurrent({ ...next, others: [{ ...current, others: undefined }, ...(current.others ?? []).filter((_, i) => i !== index)] });
        }}
      />
    </section>
  );
}
