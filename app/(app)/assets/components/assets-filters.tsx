"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@yourorg/ui";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";

/**
 * Client/site cascading filter dropdowns for the assets list/map views.
 * Narrows the server-side query (`listAssets({ clientId, siteId })`) by
 * pushing updated search params — the Suspense boundary around
 * `AssetsScreen` (see `app/(app)/assets/page.tsx`) re-fetches and shows the
 * shaped skeleton while the new filter is applied.
 */
export function AssetsFilters({
  clients,
  sites,
  selectedClientId,
  selectedSiteId,
}: {
  clients: ClientRecord[];
  sites: SiteRecord[];
  selectedClientId?: string;
  selectedSiteId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function navigate(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <>
      <Select
        aria-label="Filter by client"
        value={selectedClientId ?? ""}
        onChange={(event) =>
          navigate({ clientId: event.target.value || undefined, siteId: undefined })
        }
      >
        <option value="">All clients</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by site"
        value={selectedSiteId ?? ""}
        onChange={(event) => navigate({ siteId: event.target.value || undefined })}
        disabled={!selectedClientId}
      >
        <option value="">All sites</option>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </Select>
    </>
  );
}
