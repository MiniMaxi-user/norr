import { Suspense } from "react";
import Link from "next/link";
import { Heading, Stack, Text } from "@yourorg/ui";
import { requireSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { getClient } from "../actions";
import { ClientDetail } from "./client-detail";
import { ClientDetailSkeleton } from "./client-detail-skeleton";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense fallback={<ClientDetailSkeleton />}>
      <ClientDetailContent id={id} />
    </Suspense>
  );
}

async function ClientDetailContent({ id }: { id: string }) {
  const session = await requireSession();
  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };

  const result = await getClient(id);

  if (result.error || !result.data) {
    return (
      <Stack gap="sm">
        <Heading level={1}>Client not found</Heading>
        <Text tone="danger">{result.error ?? "Could not load this client."}</Text>
        <Link href="/clients">Back to clients</Link>
      </Stack>
    );
  }

  const canWrite = can(actor, "clients", "update");

  return <ClientDetail client={result.data.client} sites={result.data.sites} canWrite={canWrite} />;
}
