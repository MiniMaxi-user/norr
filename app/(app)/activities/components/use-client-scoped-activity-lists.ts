"use client";

import { useEffect, useState } from "react";
import { listAssets, type AssetRecord } from "@/app/(app)/assets/actions";
import { listContacts, type ContactRecord } from "@/app/(app)/clients/contacts-actions";
import { listContracts, type ContractRecord } from "@/app/(app)/contracts/actions";

/** High enough for "every asset/contact/contract of this client" in one
 * request — a per-record scope, not the org-wide lists (which paginate). */
const ALL_CLIENT_SCOPED_LIMIT = 500;

/**
 * Fetches the Assets/Contacts/Contracts belonging to a single client — the
 * option lists of the Activity page's Asset and Contact person selects and the
 * source of the derived Contract row (the activity equivalent of the work
 * order page's `useClientScopedLists`).
 *
 * `assets`/`contacts` are only needed while editing, so they are gated behind
 * `enabled` (read mode renders from the records the server already resolved).
 * `contracts` feeds the passive derived Contract row, which a read-only viewer
 * also sees, so it is fetched whenever `clientId` is set.
 */
export function useClientScopedActivityLists(clientId: string, enabled: boolean) {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingContracts, setLoadingContracts] = useState(false);

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
      setContracts([]);
      return;
    }
    let cancelled = false;
    setLoadingContracts(true);
    listContracts({ clientId, limit: ALL_CLIENT_SCOPED_LIMIT })
      .then((result) => {
        if (!cancelled) setContracts(result.data?.contracts ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingContracts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return { assets, contacts, contracts, loadingAssets, loadingContacts, loadingContracts };
}
