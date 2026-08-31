import { redirect } from "next/navigation";

/**
 * Settings landing route (issue #110, Settings admin shell stage 2) — the
 * old flat "pick a section" landing page is gone now that `SettingsShell`
 * (mounted by `layout.tsx`, which already runs the `"settings"`
 * feature/RBAC gate before `children` renders) provides a persistent left
 * rail on every settings route. `/settings` itself just lands on the first
 * reference-list leaf.
 */
export default function SettingsPage() {
  redirect("/settings/reference-lists/asset_type");
}
