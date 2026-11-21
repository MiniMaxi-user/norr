import "server-only";

import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import type { SiteContactRole } from "./schema";

/**
 * Read helpers for the site contact matrix (issue #273, `site_contact_roles`).
 * NOT a "use server" file: shared by the invoice e-mail, the work receipt
 * render/send code and the work order auto-send. Callers that need ONE contact
 * (e.g. the visit contact) take the first entry; the order is the matrix order
 * (primary contact first, then name).
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface SiteRoleContact {
  site_id: string;
  contact_id: string;
  name: string;
  email: string | null;
  is_primary: boolean;
}

/** Whether a contact currently has a usable (non-empty) e-mail address. Send-time
 * code uses this to skip contacts whose e-mail was cleared after they were ticked. */
export function hasEmail(contact: Pick<SiteRoleContact, "email">): boolean {
  return Boolean(contact.email?.trim());
}

/** Trimmed, non-empty addresses, de-duplicated case-insensitively (first spelling wins). */
export function uniqueEmails(emails: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const email = raw?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/**
 * The contacts holding `role` on any of `siteIds`, in matrix order (primary
 * contact first, then name). A contact ticked on several of the sites appears
 * once per site.
 */
export async function loadSiteRoleContacts(
  supabase: SupabaseServerClient,
  siteIds: string[],
  role: SiteContactRole,
): Promise<{ contacts: SiteRoleContact[]; error: string | null }> {
  if (siteIds.length === 0) return { contacts: [], error: null };

  const { data, error } = await supabase
    .from("site_contact_roles")
    .select("site_id, contact_id, contacts(name, email, is_primary)")
    .eq("role", role)
    .in("site_id", siteIds);
  if (error) return { contacts: [], error: error.message };

  const rows = (data ?? []) as unknown as {
    site_id: string;
    contact_id: string;
    contacts: { name: string; email: string | null; is_primary: boolean } | null;
  }[];

  const contacts = rows
    .filter((row) => row.contacts)
    .map((row) => ({
      site_id: row.site_id,
      contact_id: row.contact_id,
      name: row.contacts!.name,
      email: row.contacts!.email,
      is_primary: row.contacts!.is_primary,
    }))
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.name.localeCompare(b.name));

  return { contacts, error: null };
}
