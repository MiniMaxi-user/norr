import type { ComponentType } from "react";
import {
  LayoutDashboard,
  Users,
  Boxes,
  FileText,
  CalendarDays,
  BarChart3,
  Receipt,
} from "@yourorg/ui/icons";

/**
 * Single source of truth for primary nav entries, shared by the sidebar
 * and the command palette so they never drift out of sync.
 *
 * `moduleKey` matches the `module:*` labels used on the GitHub project
 * board (docs/ROADMAP.md) and will double as the `hasFeature()` key once
 * entitlements exist (CLAUDE.md rule 3) — see the TODO below.
 */
export interface NavItem {
  moduleKey: string;
  label: string;
  href: string;
  icon: ComponentType;
  /**
   * Phase 0 placeholder gating. Every real module ships behind
   * `hasFeature(org, moduleKey)` (CLAUDE.md rule 3) — there is no
   * entitlement system yet, so items are hardcoded `enabled: false` until
   * their module lands. Do NOT read this flag as an entitlement check once
   * `hasFeature()` exists; replace it outright instead of layering on top.
   */
  enabled: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { moduleKey: "dashboard", label: "Dashboard", href: "/", icon: LayoutDashboard, enabled: true },
  { moduleKey: "clients", label: "Clients", href: "/clients", icon: Users, enabled: false },
  { moduleKey: "assets", label: "Assets", href: "/assets", icon: Boxes, enabled: false },
  { moduleKey: "contracts", label: "Contracts", href: "/contracts", icon: FileText, enabled: false },
  { moduleKey: "planning", label: "Planning", href: "/planning", icon: CalendarDays, enabled: false },
  { moduleKey: "reporting", label: "Reporting", href: "/reporting", icon: BarChart3, enabled: false },
  { moduleKey: "billing", label: "Facturatie", href: "/billing", icon: Receipt, enabled: false },
];
