repo: MiniMaxi-user/norr
branch: main

## Last sync
date: 2026-09-12T09:07:22Z

### Updated in this project
- Read design tokens (Fjord/Snö/Mässing palette, type scale, radii) from `packages/ui/src/styles.css`.
- Read the PWA work-items list + offline cache to ground the dashboard content.
- Read the desktop work order hero and hours section for detail-page structure.
- Built three mobile concepts for the engineer PWA (overview + work order detail).
- Replaced placeholder glyphs with the repo's own icon paths from `packages/ui/src/icons.tsx`.

## Screen map
| Screen | Repo files |
| --- | --- |
| Work order overview (1a/1c) | apps/pwa/app/(app)/workitems/work-items-list.tsx, apps/pwa/app/api/workitems/today/route.ts |
| Work order detail (1a/1b/1c) | app/(app)/work-orders/components/work-order-hero.tsx, app/(app)/work-orders/components/work-order-hours-section.tsx |
| Visual language (all) | packages/ui/src/styles.css, packages/ui/src/icons.tsx, docs/DESIGN-SYSTEM.md, docs/logo/LEESMIJ.txt |
