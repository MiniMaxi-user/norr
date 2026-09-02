"use client";

import { useEffect, useState } from "react";
import { listAssets, type AssetRecord } from "@/app/(app)/assets/actions";
import { listContacts, type ContactRecord } from "@/app/(app)/clients/contacts-actions";
import { listSites, type SiteRecord } from "@/app/(app)/clients/actions";

/** High enough for "every asset/contact/site across this client" in one
 * request — same bounded, per-record-scope reasoning as `useClientScopedLists`'s own
 * `ALL_CLIENT_SCOPED_LIMIT` in `app/(app)/work-orders/components/use-client-scoped-lists.ts`. */
const ALL_CLIENT_SCOPED_LIMIT = 500;

/**
 * Fetches the Sites/Assets/Contacts belonging to a single client — the
 * Activity equivalent of `useClientScopedLists`
 * (`app/(app)/work-orders/components/use-client-scoped-lists.ts`), minus
 * Contracts (an activity has no relation to one). Shared by `ActivityHero`'s
 * relation cards (to resolve the Client/Asset cards' "KvK … · address"/
 * "{type} · {location}" subtitles as soon as a different client is picked,
 * before any save — issue #118) and `ActivityRelationsDialog` (as the
 * Asset/Contact picker option lists) — one hook call at the `ActivityScreen`
 * level, same "both always see the exact same fetched lists" reasoning that
 * hook's own doc comment gives. `sites` was added by issue #118 (previously
 * only `assets`/`contacts`) — an activity has no `site_id` of its own, but
 * its Client/Asset relation cards both need a site lookup (the client's
 * primary site, and the resolved asset's own `site_id`) to build their new
 * "KvK … · address" / "{type} · {location}" subtitles.
 *
 * `sites` is fetched whenever `clientId` is set, INDEPENDENT of `enabled` —
 * unlike `assets`/`contacts` (only ever needed for the edit-only relations
 * dialog's pickers, so gated behind `enabled = !readOnly`), `sites` also
 * feeds the relation cards' own passive subtitle text, which a `readOnly`
 * viewer still needs to see even though they can never open that dialog.
 */
export function useClientScopedActivityLists(clientId: string, enabled: boolean) {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingSites, setLoadingSites] = useState(false);

  useEffect(() => {
    if (!enabled || !clientId) {
      setAssets([]);
      return;
    }
    let cancelled = false;
    setLoadingAssets(true);
    listAssets({ clientId, limit: ALL_CLIENT_SCOPED_LIMIT })
      .then((result) => {
        if (!cancelled) setAssets(result.data?.assets ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingAssets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, clientId]);

  useEffect(() => {
    if (!enabled || !clientId) {
      setContacts([]);
      return;
    }
    let cancelled = false;
    setLoadingContacts(true);
    listContacts(clientId)
      .then((result) => {
        if (!cancelled) setContacts(result.data?.contacts ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingContacts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, clientId]);

  useEffect(() => {
    if (!clientId) {
      setSites([]);
      return;
    }
    let cancelled = false;
    setLoadingSites(true);
    listSites(clientId)
      .then((result) => {
        if (!cancelled) setSites(result.data?.sites ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingSites(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return { assets, contacts, sites, loadingAssets, loadingContacts, loadingSites };
}
