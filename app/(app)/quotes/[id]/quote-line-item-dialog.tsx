"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Dialog, FormGrid, FormSection, Heading, Input, Label, Select, Stack, Text, Textarea } from "@yourorg/ui";
import { createQuoteLineItem, updateQuoteLineItem, type QuoteLineItemRecord } from "../actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";

interface QuoteLineItemDialogState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: QuoteLineItemDialogState = {};

export interface QuoteLineItemDialogProps {
  quoteId: string;
  /** Present when editing an existing line item; omitted for "add". */
  lineItem?: QuoteLineItemRecord | null;
  /** Assets belonging to the quote's own client — the optional "linked
   * asset" picker filters to these, mirroring `quote_line_items.asset_id`'s
   * "must belong to the quote's own client" DB constraint
   * (`validate_quote_line_item_relations`). */
  clientAssets: AssetRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Add/edit dialog for a single quote line item — correctly a small popup per
 * docs/ARCHITECTURE.md "Popup vs. full page" ("a small, secondary sub-entity
 * reached from a tab... this standard is about relationship *visibility*,
 * not about banning every dialog" — a quote line item is exactly that kind
 * of small flat record, same weight as a Site/Contact dialog), same
 * `useActionState` wrapper shape as `app/(app)/clients/site-form-dialog.tsx`.
 */
export function QuoteLineItemDialog({ quoteId, lineItem, clientAssets, open, onOpenChange }: QuoteLineItemDialogProps) {
  const isEdit = Boolean(lineItem);
  const router = useRouter();

  async function action(
    _prevState: QuoteLineItemDialogState,
    formData: FormData,
  ): Promise<QuoteLineItemDialogState> {
    const input = Object.fromEntries(formData.entries());
    const result = isEdit
      ? await updateQuoteLineItem(lineItem!.id, input)
      : await createQuoteLineItem(quoteId, input);
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
        <Heading level={3}>{isEdit ? "Edit line item" : "Add line item"}</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="lg">
            {state.error && <Text tone="danger">{state.error}</Text>}

            <FormSection title="Line item" description="What this line covers, and how it's priced.">
              <Stack gap="md">
                <Stack gap="sm">
                  <Label htmlFor="line-item-description">Description</Label>
                  <Textarea
                    id="line-item-description"
                    name="description"
                    defaultValue={lineItem?.description ?? ""}
                    required
                    rows={2}
                  />
                  {state.fieldErrors?.description && <Text tone="danger">{state.fieldErrors.description[0]}</Text>}
                </Stack>

                <FormGrid columns={2}>
                  <Stack gap="sm">
                    <Label htmlFor="line-item-quantity">Quantity</Label>
                    <Input
                      id="line-item-quantity"
                      name="quantity"
                      type="number"
                      step="0.01"
                      min="0.01"
                      defaultValue={lineItem?.quantity ?? 1}
                      required
                    />
                    {state.fieldErrors?.quantity && <Text tone="danger">{state.fieldErrors.quantity[0]}</Text>}
                  </Stack>

                  <Stack gap="sm">
                    <Label htmlFor="line-item-unit-price">Unit price</Label>
                    <Input
                      id="line-item-unit-price"
                      name="unitPrice"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={lineItem?.unit_price ?? 0}
                      required
                    />
                    {state.fieldErrors?.unitPrice && <Text tone="danger">{state.fieldErrors.unitPrice[0]}</Text>}
                  </Stack>
                </FormGrid>

                <Stack gap="sm">
                  <Label htmlFor="line-item-asset">Linked asset</Label>
                  <Select id="line-item-asset" name="assetId" defaultValue={lineItem?.asset_id ?? ""}>
                    <option value="">No specific asset</option>
                    {clientAssets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name}
                      </option>
                    ))}
                  </Select>
                  {state.fieldErrors?.assetId && <Text tone="danger">{state.fieldErrors.assetId[0]}</Text>}
                </Stack>
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
      {pending ? "Saving…" : isEdit ? "Save changes" : "Add line item"}
    </Button>
  );
}
