import Link from "next/link";
import { Card, Heading, Text, Stack, Badge } from "@yourorg/ui";
import { createClient } from "@/lib/supabase/server";
import { AcceptInviteForm } from "./accept-invite-form";

interface InviteRow {
  organization_id: string;
  organization_name: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  is_expired: boolean;
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  // Token-gated lookup (works whether the visitor is signed in or not — see
  // the migration for get_invite_by_token). Not a raw table SELECT: the
  // token itself is the capability, not an RLS grant.
  const { data: invite } = await supabase
    .rpc("get_invite_by_token", { p_token: token })
    .maybeSingle<InviteRow>();

  if (!invite) {
    return (
      <Stack gap="lg">
        <Heading level={1}>Invite not found</Heading>
        <Text tone="muted">
          This invite link is invalid. Ask your organization owner to send a new one.
        </Text>
      </Stack>
    );
  }

  if (invite.accepted_at) {
    return (
      <Stack gap="lg">
        <Heading level={1}>Invite already used</Heading>
        <Text tone="muted">This invite has already been accepted.</Text>
        <Link href="/login">Log in</Link>
      </Stack>
    );
  }

  if (invite.is_expired) {
    return (
      <Stack gap="lg">
        <Heading level={1}>Invite expired</Heading>
        <Text tone="muted">
          This invite has expired. Ask an owner of {invite.organization_name} to send a new one.
        </Text>
      </Stack>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const emailMatches = user?.email?.toLowerCase() === invite.email.toLowerCase();

  return (
    <Stack gap="lg">
      <Stack gap="sm">
        <Heading level={1}>You&rsquo;re invited to {invite.organization_name}</Heading>
        <Text tone="muted">
          Role: <Badge>{invite.role}</Badge> &middot; invited email: {invite.email}
        </Text>
      </Stack>

      <Card>
        {!user && (
          <Stack gap="md">
            <Text>
              Log in or create an account with <strong>{invite.email}</strong> to accept this
              invite.
            </Text>
            <Stack gap="sm">
              <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Log in</Link>
              <Link
                href={`/signup?inviteToken=${encodeURIComponent(token)}&email=${encodeURIComponent(
                  invite.email,
                )}`}
              >
                Create account
              </Link>
            </Stack>
          </Stack>
        )}

        {user && !emailMatches && (
          <Stack gap="md">
            <Text tone="danger">
              You&rsquo;re signed in as {user.email}, but this invite was sent to {invite.email}.
            </Text>
            <Text tone="muted">Log out and sign in with the invited email to accept it.</Text>
          </Stack>
        )}

        {user && emailMatches && <AcceptInviteForm token={token} />}
      </Card>
    </Stack>
  );
}
