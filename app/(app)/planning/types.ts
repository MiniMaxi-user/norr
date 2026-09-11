/**
 * Shared Planning module types (issue #164) — kept out of `page.tsx` itself
 * (unlike `AssetsView`, which lives in `assets-view-switcher.tsx` and is
 * imported BY that module's `page.tsx`) so every component can import these
 * without an inverted dependency on the route file.
 */
export type PlanningView = "day" | "week";
export type PlanningGroup = "region" | "engineer";
