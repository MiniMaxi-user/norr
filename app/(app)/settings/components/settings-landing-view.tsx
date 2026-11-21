"use client";

import { useMemo, useState } from "react";
import { WebCard, WebCardGrid, WebHint, WebLinkRow } from "@yourorg/ui/web";
import { SETTINGS_NAV_GROUPS } from "./settings-nav-items";

export interface SettingsLandingViewProps {
  /** Per-item counts keyed by `SettingsNavItem.key`, resolved server-side by
   * `SettingsLandingScreen`. A key with no entry (a form-type section such as
   * default rates has no natural "count") renders no count at all, rather
   * than a misleading `0`. */
  counts: Record<string, number>;
  /** Section keys not shown (not permitted for this role). */
  hiddenKeys?: string[];
}

/**
 * Client half of the Settings landing page (web design system, issue #222):
 * one card per `SETTINGS_NAV_GROUPS` entry, each listing its sections as link
 * rows with the live item count as a mono number. No hero band, no KPI tiles,
 * no icons in the card titles. Owns just the search-filter `query` state.
 */
const NO_HIDDEN_KEYS: string[] = [];

export function SettingsLandingView({ counts, hiddenKeys = NO_HIDDEN_KEYS }: SettingsLandingViewProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const visibleGroups = useMemo(
    () =>
      SETTINGS_NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => !hiddenKeys.includes(item.key)),
      })).filter((group) => group.items.length > 0),
    [hiddenKeys],
  );

  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return visibleGroups;
    return visibleGroups.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLowerCase().includes(normalizedQuery)),
    })).filter((group) => group.items.length > 0);
  }, [normalizedQuery, visibleGroups]);

  return (
    <div className="web-tab-stack">
      <input
        type="search"
        className="web-input web-settings-search"
        aria-label="Search settings"
        placeholder="Search settings…"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <WebCardGrid>
        {filteredGroups.map((group) => (
          <WebCard key={group.label} title={group.label}>
            {group.items.map((item) => (
              <WebLinkRow key={item.key} href={item.href} label={item.label} count={counts[item.key]} />
            ))}
          </WebCard>
        ))}
      </WebCardGrid>

      {filteredGroups.length === 0 ? <WebHint>Nothing in Settings matches &ldquo;{query.trim()}&rdquo;.</WebHint> : null}
    </div>
  );
}
