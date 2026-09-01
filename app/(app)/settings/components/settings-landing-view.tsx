"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, EmptyState } from "@yourorg/ui";
import { Search } from "@yourorg/ui/icons";
import { SETTINGS_NAV_GROUPS } from "./settings-nav-items";

export interface SettingsLandingViewProps {
  /** Per-item counts keyed by `SettingsNavItem.key`, resolved server-side by
   * `SettingsLandingScreen`. A key with no entry (e.g. `default_rates`,
   * which has no natural "count" — it's a two-field settings form, not a
   * list) renders no count pill at all, rather than a misleading `0`. */
  counts: Record<string, number>;
  totalItems: number;
  totalGroups: number;
}

/**
 * Client half of the Settings landing page (design handoff "Settings
 * landing redesign", option 2a) — owns just the search-filter `query`
 * state; `SETTINGS_NAV_GROUPS` is imported directly here (same static,
 * client-safe module `SettingsShell` already imports) rather than passed
 * down as a prop, since a `SettingsNavGroup.icon` is a component reference
 * and can't cross the Server/Client prop boundary the way plain data
 * (`counts`/`totalItems`/`totalGroups`) can.
 */
export function SettingsLandingView({ counts, totalItems, totalGroups }: SettingsLandingViewProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return SETTINGS_NAV_GROUPS;
    return SETTINGS_NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLowerCase().includes(normalizedQuery)),
    })).filter((group) => group.items.length > 0);
  }, [normalizedQuery]);

  return (
    <>
      <div className="ui-settings-landing-band">
        <div className="ui-settings-landing-band-top">
          <div className="ui-settings-landing-band-titles">
            <span className="ui-settings-landing-band-eyebrow">Administration</span>
            <h1 className="ui-settings-landing-band-title">Settings</h1>
            <div className="ui-settings-landing-band-subtitle">
              {totalItems} configurable list{totalItems === 1 ? "" : "s"} across {totalGroups} area
              {totalGroups === 1 ? "" : "s"}
            </div>
          </div>
          <div className="ui-settings-landing-band-search">
            <Search aria-hidden />
            <input
              type="text"
              aria-label="Search settings"
              placeholder="Search settings…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="ui-settings-landing-grid-wrap">
        <div className="ui-settings-landing-grid">
          {filteredGroups.map((group) => (
            <Card key={group.label} className="ui-settings-landing-card">
              <div className="ui-settings-landing-card-head">
                <span className="ui-settings-landing-card-icon">
                  <group.icon />
                </span>
                <h2 className="ui-settings-landing-card-title">{group.label}</h2>
              </div>
              <div className="ui-settings-landing-card-items">
                {group.items.map((item) => {
                  const count = counts[item.key];
                  return (
                    <Link key={item.key} href={item.href} className="ui-settings-landing-row">
                      <span className="ui-settings-landing-row-label">{item.label}</span>
                      {count !== undefined && <span className="ui-settings-landing-row-count">{count}</span>}
                    </Link>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>

        {filteredGroups.length === 0 && (
          <EmptyState
            icon={<Search />}
            heading="No matching settings"
            text={`Nothing in Settings matches "${query.trim()}".`}
          />
        )}
      </div>
    </>
  );
}
