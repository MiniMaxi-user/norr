"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  FormGrid,
  FormGridFull,
  FormSection,
  Heading,
  Label,
  Stack,
  Text,
  Textarea,
} from "@yourorg/ui";
import { Building2, FileText, MapPin } from "@yourorg/ui/icons";
import { createSite, updateSite, type SiteRecord } from "./actions";
import { FormField } from "./form-field";
import { useEscapeToClose } from "./use-escape-to-close";

interface SiteFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: SiteFormState = {};

/**
 * Create/edit dialog for a client's site — same `useActionState` wrapper
 * pattern as `client-form-dialog.tsx`. `clientId` is only submitted on
 * create (a hidden field); on edit it's intentionally omitted so an edit
 * never accidentally re-parents the site (moving it to a different client
 * of the same org is a real, allowed edit per `siteUpdateSchema`'s comment,
 * but not a control this dialog exposes today).
 */
export function SiteFormDialog({
  open,
  onOpenChange,
  clientId,
  site,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  site?: SiteRecord | null;
}) {
  const isEdit = Boolean(site);
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  async function action(_prevState: SiteFormState, formData: FormData): Promise<SiteFormState> {
    const input = Object.fromEntries(formData.entries());
    const result = isEdit ? await updateSite(site!.id, input) : await createSite(input);
    if (result.error || !result.data) {
      return { error: result.error ?? "Something went wrong.", fieldErrors: result.fieldErrors };
    }
    return { success: true };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success) {
      onOpenChange(false);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg">
      <Dialog.Header>
        <Heading level={3}>{isEdit ? "Edit site" : "Add site"}</Heading>
      </Dialog.Header>
      <form action={formAction}>
        {!isEdit && <input type="hidden" name="clientId" value={clientId} />}
        <Dialog.Body>
          <Stack gap="lg">
            {state.error && <Text tone="danger">{state.error}</Text>}

            <FormSection title="Site" icon={<Building2 />}>
              <FormField
                label="Name"
                name="name"
                defaultValue={site?.name}
                required
                errors={state.fieldErrors?.name}
              />
            </FormSection>

            <FormSection title="Address" icon={<MapPin />}>
              <FormField
                label="Address line 1"
                name="addressLine1"
                defaultValue={site?.address_line1}
                errors={state.fieldErrors?.addressLine1}
              />
              <FormField
                label="Address line 2"
                name="addressLine2"
                defaultValue={site?.address_line2}
                errors={state.fieldErrors?.addressLine2}
              />
              <FormGrid>
                <FormField
                  label="Postal code"
                  name="postalCode"
                  defaultValue={site?.postal_code}
                  errors={state.fieldErrors?.postalCode}
                />
                <FormField label="City" name="city" defaultValue={site?.city} errors={state.fieldErrors?.city} />
                <FormGridFull>
                  <FormField
                    label="Country"
                    name="country"
                    defaultValue={site?.country}
                    errors={state.fieldErrors?.country}
                  />
                </FormGridFull>
              </FormGrid>
            </FormSection>

            <FormSection
              title="Coordinates"
              description="Used to place this site on the map view."
              icon={<MapPin />}
            >
              <FormGrid>
                <FormField
                  label="Latitude"
                  name="latitude"
                  type="number"
                  step="any"
                  defaultValue={site?.latitude ?? undefined}
                  errors={state.fieldErrors?.latitude}
                />
                <FormField
                  label="Longitude"
                  name="longitude"
                  type="number"
                  step="any"
                  defaultValue={site?.longitude ?? undefined}
                  errors={state.fieldErrors?.longitude}
                />
              </FormGrid>
            </FormSection>

            <FormSection title="Notes" icon={<FileText />}>
              <Stack gap="xs">
                <Label htmlFor="site-notes">Internal notes</Label>
                <Textarea id="site-notes" name="notes" defaultValue={site?.notes ?? ""} />
                {state.fieldErrors?.notes?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>
            </FormSection>
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton isEdit={isEdit} />
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Add site"}
    </Button>
  );
}
