"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import { WebConfirmDialog } from "@yourorg/ui/web-client";
import { activateAsTenant } from "../actions";
import { setTenantActive } from "../platform-access-actions";

/**
 * Platform-admin tenant actions (issues #45/#47), moved out of the old hero
 * into the design system's header: "Activate as tenant" is the page's single
 * navy primary action, "Deactivate/Reactivate tenant" lives in the ··· menu.
 * Gating (platform admin only, one-way activation, active vs deactivated) is
 * decided by the parent exactly as before — these components only run the
 * existing server actions (`activateAsTenant`, `setTenantActive`) behind a
 * confirmation.
 */

export function ActivateTenantDialog({
  open,
  clientId,
  onClose,
}: {
  open: boolean;
  clientId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const result = await activateAsTenant(clientId);
      if (result.error || !result.data) {
        setError(result.error ?? "Could not activate this client as a tenant. Try again.");
        return;
      }
      onClose();
      toast({ title: "Tenant activated", tone: "success", duration: 3000 });
      router.refresh();
    } catch {
      setError("Could not activate this client as a tenant. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <WebConfirmDialog
      open={open}
      title="Activate as tenant?"
      confirmLabel="Activate as tenant"
      confirmVariant="primary"
      pending={pending}
      error={error}
      onCancel={() => {
        setError(null);
        onClose();
      }}
      onConfirm={confirm}
    >
      This turns the client into a real platform tenant. It cannot be undone, but the tenant can be deactivated later.
    </WebConfirmDialog>
  );
}

export function DeactivateTenantDialog({
  open,
  clientId,
  onClose,
}: {
  open: boolean;
  clientId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const result = await setTenantActive(clientId, false);
      if (result.error || !result.data) {
        setError(result.error ?? "Could not deactivate this tenant. Try again.");
        return;
      }
      onClose();
      toast({ title: "Tenant deactivated", duration: 3000 });
      router.refresh();
    } catch {
      setError("Could not deactivate this tenant. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <WebConfirmDialog
      open={open}
      title="Deactivate this tenant?"
      confirmLabel="Deactivate tenant"
      confirmVariant="danger"
      pending={pending}
      error={error}
      onCancel={() => {
        setError(null);
        onClose();
      }}
      onConfirm={confirm}
    >
      Everyone at this organization will immediately lose the ability to log in. You can reactivate this tenant at any
      time to restore their access.
    </WebConfirmDialog>
  );
}

/** Reactivation is fully additive (nobody loses anything), so it needs no
 * confirmation — same as before. Failure surfaces as a toast: there is no
 * form field to attach it to. */
export async function reactivateTenant(clientId: string, refresh: () => void) {
  try {
    const result = await setTenantActive(clientId, true);
    if (result.error || !result.data) {
      toast({
        title: "Tenant not reactivated",
        description: result.error ?? "Could not reactivate this tenant. Try again.",
        tone: "danger",
        duration: 6000,
      });
      return;
    }
    toast({ title: "Tenant reactivated", tone: "success", duration: 3000 });
    refresh();
  } catch {
    toast({ title: "Tenant not reactivated", description: "Could not reactivate this tenant. Try again.", tone: "danger" });
  }
}
