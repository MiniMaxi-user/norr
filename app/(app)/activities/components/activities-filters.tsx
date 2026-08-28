"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@yourorg/ui";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";

export interface ActivitiesFiltersProps {
  clients: ClientRecord[];
  members: OrgMemberRecord[];
  activityTypes: ReferenceListItemRecord[];
  activityStatuses: ReferenceListItemRecord[];
  selectedClientId?: string;
  selectedActionHolderId?: string;
  selectedTypeId?: string;
  selectedStatusId?: string;
}

/**
 * Status/type/client/action-holder filter dropdowns for the Activities
 * overview (AC: "Activiteiten overzicht scherm is beschikbaar (met
 * filtering en add new)") — same "push updated search params, let the
 * `Suspense` boundary re-fetch behind a shaped skeleton" shape as
 * `AssetsFilters`.
 */
export function ActivitiesFilters({
  clients,
  members,
  activityTypes,
  activityStatuses,
  selectedClientId,
  selectedActionHolderId,
  selectedTypeId,
  selectedStatusId,
}: ActivitiesFiltersProps) {
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
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <>
      <Select
        aria-label="Filter by status"
        value={selectedStatusId ?? ""}
        onChange={(event) => navigate({ statusId: event.target.value || undefined })}
      >
        <option value="">All statuses</option>
        {activityStatuses.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by type"
        value={selectedTypeId ?? ""}
        onChange={(event) => navigate({ typeId: event.target.value || undefined })}
      >
        <option value="">All types</option>
        {activityTypes.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by client"
        value={selectedClientId ?? ""}
        onChange={(event) => navigate({ clientId: event.target.value || undefined })}
      >
        <option value="">All clients</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by action holder"
        value={selectedActionHolderId ?? ""}
        onChange={(event) => navigate({ actionHolderId: event.target.value || undefined })}
      >
        <option value="">All action holders</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {memberDisplayName(member)}
          </option>
        ))}
      </Select>
    </>
  );
}
