import type { TenantRole } from "@/lib/rbac/permissions";

/**
 * Display label for a `TenantRole` — same "capitalize the first letter, do
 * nothing else" formatting `components/shell/user-menu.tsx` already uses for
 * the topbar's role display (`role.charAt(0).toUpperCase() + role.slice(1)`),
 * kept here as a small shared helper so the invite form, the per-row role
 * `<Select>`, and the pending-invites table don't each re-derive it slightly
 * differently.
 */
export function roleLabel(role: TenantRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
