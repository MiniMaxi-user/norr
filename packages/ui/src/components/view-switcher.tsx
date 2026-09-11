import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
import { Button } from "./button";

export interface ViewSwitcherOption<T extends string = string> {
  value: T;
  label: ReactNode;
}

export interface ViewSwitcherProps<T extends string = string>
  extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  options: readonly ViewSwitcherOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * ViewSwitcher — generic labeled group of pill/button view options
 * (List/Map, List/Kanban, Dag/Week, Per regio/Alle monteurs, ...), promoted
 * out of `app/(app)/assets/components/assets-view-switcher.tsx` and
 * `app/(app)/clients/components/view-toggle.tsx` once a second (then third)
 * module needed the exact same switcher — see those two files' own former
 * doc comments, which already flagged this duplication and asked for it to
 * land here. Built for the Planning module's Dag/Week and Per-regio/
 * Alle-monteurs toggles (issue #164) as well as the two existing call
 * sites, all of which are simple 2-option pill groups, though this makes no
 * assumption about option count.
 *
 * Deliberately hook-free/stateless, matching this package's established
 * convention for every compound component reachable from the main
 * `dist/index.js` entry (`Board`, `DropdownMenu`, `CommandPalette`, ...) —
 * see `board.tsx`'s own doc comment for why: this file is bundled alongside
 * dozens of other components reachable from Server Components, and Next's
 * RSC compiler rejects ANY hook usage anywhere in a file reached that way.
 * All the app-specific plumbing — reading/writing the `?view=` URL search
 * param, persisting the choice via `setLastUsedView(moduleKey, view)` from
 * `lib/preferences/actions.ts`, wrapping the persist call in
 * `useTransition` — stays entirely at the call site; this component only
 * renders the options and reports a selection via `onChange`.
 *
 * ```tsx
 * <ViewSwitcher
 *   aria-label="Change view"
 *   value={view}
 *   options={[{ value: "list", label: "List" }, { value: "map", label: "Map" }]}
 *   onChange={(next) => selectView(next)}
 * />
 * ```
 */
export function ViewSwitcher<T extends string = string>({
  options,
  value,
  onChange,
  className,
  ...rest
}: ViewSwitcherProps<T>) {
  return (
    <div role="group" className={cx("ui-view-switcher", className)} {...rest}>
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          variant={option.value === value ? "primary" : "outline"}
          size="sm"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
