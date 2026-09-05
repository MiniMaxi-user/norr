import type { ClientRecord } from "../actions";
import type { ClientStatus } from "../kanban";

/**
 * The client's own editable fields, as one flat draft object — the single
 * source of truth `ClientDetailsTab` (edit) and `ClientCreateScreen` (create)
 * both own, mirroring `app/(app)/assets/components/asset-draft.ts`'s exact
 * shape/role for the unified Asset screen. Every section (Business details/
 * Pipeline/Rate/Notes) reads from this and writes back through its owner's
 * own `commitPatch`-style callback.
 *
 * Every field here is kept as a plain string/boolean (never `null`) — same
 * "raw `<input>`-shaped values, converted only at the save boundary"
 * convention `AssetDraft` uses — so a controlled `<Input>`/`<Select>` never
 * has to special-case `null`.
 *
 * The rate-override fields (`hasCustomRate`.../`workSalePrice`) are NOT part
 * of `clientCreateSchema`/`clientUpdateSchema` — they're written through the
 * separate `updateClientRateSettings` action (see `../actions.ts`) — but they
 * live in the same flat draft here since the Rate section needs a draft slice
 * too, same as every other section.
 */
export interface ClientDraft {
  name: string;
  kvkNumber: string;
  vatNumber: string;
  iban: string;
  notes: string;
  status: ClientStatus;
  accountManagerId: string;
  potentialValue: string;
  clientSince: string;
  hasCustomRate: boolean;
  travelArticleId: string;
  workArticleId: string;
  travelSalePrice: string;
  workSalePrice: string;
}

export function draftFromClient(client: ClientRecord): ClientDraft {
  return {
    name: client.name,
    kvkNumber: client.kvk_number ?? "",
    vatNumber: client.vat_number ?? "",
    iban: client.iban ?? "",
    notes: client.notes ?? "",
    status: (client.status as ClientStatus) ?? "lead",
    accountManagerId: client.account_manager_id ?? "",
    potentialValue: client.potential_value != null ? String(client.potential_value) : "",
    clientSince: client.client_since ?? "",
    hasCustomRate: client.has_custom_rate,
    travelArticleId: client.travel_article_id ?? "",
    workArticleId: client.work_article_id ?? "",
    travelSalePrice: client.travel_sale_price != null ? String(client.travel_sale_price) : "",
    workSalePrice: client.work_sale_price != null ? String(client.work_sale_price) : "",
  };
}

/** `todayIso` — the server-computed "today" (`YYYY-MM-DD`), same "Client
 * since" CREATE-only default `new-client-panel.tsx` used to apply (never
 * auto-filled on edit — see `ClientPipelineSection`'s own doc comment). */
export function emptyDraft(todayIso: string): ClientDraft {
  return {
    name: "",
    kvkNumber: "",
    vatNumber: "",
    iban: "",
    notes: "",
    status: "lead",
    accountManagerId: "",
    potentialValue: "",
    clientSince: todayIso,
    hasCustomRate: false,
    travelArticleId: "",
    workArticleId: "",
    travelSalePrice: "",
    workSalePrice: "",
  };
}

/**
 * Converts a draft (or a partial patch of one) into the shape
 * `createClient`/`updateClient` (`../actions.ts`) expect. Unlike
 * `asset-draft.ts`'s `draftToInput`, this deliberately does NOT collapse an
 * empty string to `undefined` — `clientUpdateSchema`'s own
 * `optionalAccountManagerId`/`optionalPotentialValueSchema`/
 * `optionalIsoDateSchema` preprocessors already treat `""` as "not provided",
 * and `updateClient`'s `toClientUpdateRow` specifically inspects the RAW
 * (pre-zod) input for an explicit `""` to distinguish "clear this field" from
 * "field omitted" (see that function's own comment) — collapsing to
 * `undefined` here would erase that distinction before it ever reaches the
 * action. Only fields actually present on `patch` are included, so a
 * section's own partial save never touches fields it doesn't own. Rate-
 * override fields are deliberately excluded — see `draftToRateInput` below.
 */
export function draftToClientInput(patch: Partial<ClientDraft>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (patch.name !== undefined) input.name = patch.name;
  if (patch.kvkNumber !== undefined) input.kvkNumber = patch.kvkNumber;
  if (patch.vatNumber !== undefined) input.vatNumber = patch.vatNumber;
  if (patch.iban !== undefined) input.iban = patch.iban;
  if (patch.notes !== undefined) input.notes = patch.notes;
  if (patch.status !== undefined) input.status = patch.status;
  if (patch.accountManagerId !== undefined) input.accountManagerId = patch.accountManagerId;
  if (patch.potentialValue !== undefined) input.potentialValue = patch.potentialValue;
  if (patch.clientSince !== undefined) input.clientSince = patch.clientSince;
  return input;
}

/** Converts the Rate section's own draft slice into the shape
 * `updateClientRateSettings` expects (`rateOverrideSchema`, see
 * `lib/rate-overrides/schema.ts`) — used by `ClientCreateScreen`'s
 * `handleCreate` for its own third, sequential `updateClientRateSettings`
 * call (mirrors `new-client-panel.tsx`'s old third-call shape). Empty-string
 * article/price fields become `undefined` here (unlike
 * `draftToClientInput`) since this is a full-object, CREATE-only call, not a
 * partial "did the caller touch this field" patch — there's no
 * clear-vs-omitted ambiguity to preserve. */
export function draftToRateInput(
  draft: Pick<ClientDraft, "hasCustomRate" | "travelArticleId" | "workArticleId" | "travelSalePrice" | "workSalePrice">,
): Record<string, unknown> {
  return {
    hasCustomRate: draft.hasCustomRate,
    travelArticleId: draft.travelArticleId || undefined,
    workArticleId: draft.workArticleId || undefined,
    travelSalePrice: draft.travelSalePrice || undefined,
    workSalePrice: draft.workSalePrice || undefined,
  };
}
