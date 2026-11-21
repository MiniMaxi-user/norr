/**
 * Structured error info for asset Server Actions (issue #274). Plain types and
 * helpers, NOT a "use server" file (those may only export async functions).
 *
 * The asset actions keep returning `ActionResult<T>` (`error` is always a readable
 * sentence); on top of that a failure can carry `errorInfo` so the UI can render a
 * richer message with links. `errorInfo` is only set for the cases below, everything
 * else is just `error` / `fieldErrors`.
 */

export interface AssetRef {
  id: string;
  name: string;
}

export type AssetErrorInfo =
  /** The asset (or one of its components) is still on an open Draft/Active contract, so it
   * cannot get an inactive status. UI: "Remove the asset from contract <number> first". */
  | {
      code: "asset_on_contract";
      contracts: { id: string; number: string; status: "draft" | "active"; assetId: string; assetName: string }[];
    }
  /** Another ACTIVE asset of the same model already has this serial number
   * (case/whitespace-insensitive). UI: "Serial number <x> is already used by <asset> (<client>)". */
  | { code: "serial_in_use"; serialNumber: string; asset: AssetRef; client: AssetRef | null }
  /** The chosen previous asset already has a successor. */
  | { code: "previous_asset_has_successor"; asset: AssetRef }
  /** A site of another client was chosen: an asset never moves to another client. */
  | { code: "asset_client_immutable" };

/** `ActionResult` plus the optional structured detail. */
export interface AssetActionResult<T = undefined> {
  data?: T;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  errorInfo?: AssetErrorInfo;
}

export const ASSET_CLIENT_MOVE_MESSAGE =
  "An asset can't move to another client. Make it inactive and create a new asset at the new client.";

/** `Remove the asset from contract CON-1, CON-2 first.` */
export function describeAssetOnContract(info: Extract<AssetErrorInfo, { code: "asset_on_contract" }>): string {
  const numbers = [...new Set(info.contracts.map((c) => c.number))];
  return `Remove the asset from contract ${numbers.join(", ")} first.`;
}

export function describeSerialInUse(info: Extract<AssetErrorInfo, { code: "serial_in_use" }>): string {
  return `Serial number ${info.serialNumber} is already used by ${info.asset.name}${info.client ? ` (${info.client.name})` : ""}.`;
}

/** An asset on the other side of a predecessor/successor link, with its client for display. */
export interface AssetRelation {
  id: string;
  name: string;
  client_id: string;
  client_name: string | null;
}

/** One row for the "previous asset" picker / the inactive-asset suggestion. */
export interface InactiveAssetOption {
  id: string;
  name: string;
  serial_number: string | null;
  model: { id: string; name: string } | null;
  client: { id: string; name: string };
}
