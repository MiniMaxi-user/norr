import type { OrgMemberRecord } from "./actions";

/**
 * Display label for an org member — full name, falling back to email for an
 * account that hasn't set one yet. Kept in a plain (non-`"use server"`)
 * module, unlike `./actions.ts`, since a Server Action file may only export
 * async functions — this is a pure formatting helper, safe to import from
 * both Server and Client Components.
 */
export function memberDisplayName(member: Pick<OrgMemberRecord, "email" | "full_name"> | null | undefined): string {
  if (!member) return "Unassigned";
  return member.full_name?.trim() || member.email;
}
