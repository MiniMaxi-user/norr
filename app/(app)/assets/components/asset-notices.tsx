"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { WebButton, WebCard } from "@yourorg/ui/web";
import { ASSET_CLIENT_MOVE_MESSAGE, type AssetErrorInfo, type AssetRelation, type InactiveAssetOption } from "../asset-errors";

/**
 * Notices of the Asset page (issue #274), all in the card + info/warning summary pattern of the End contract
 * page; no ad-hoc styling.
 */

/** Calm "Inactive" notice at the top of an inactive asset's page, with the successor link when there is one. */
export function AssetInactiveNotice({ successor }: { successor: AssetRelation | null }) {
  return (
    <WebCard title="Inactive">
      <div className="web-dialog-summary" data-tone="info">
        This asset is no longer in use. It stays visible here and on its history, but it cannot be added to new work
        orders, contracts or activities.
        {successor ? (
          <>
            {" "}
            Successor: <Link href={`/assets/${successor.id}`}>{successor.name}</Link>
            {successor.client_name ? ` (${successor.client_name})` : ""}.
          </>
        ) : null}
      </div>
    </WebCard>
  );
}

/** Why a save was refused, with links to what the user has to fix first. */
export function AssetSaveErrorNotice({ info }: { info: AssetErrorInfo }) {
  let body: ReactNode = null;
  switch (info.code) {
    case "asset_on_contract":
      body = (
        <>
          Remove the asset from contract{" "}
          {info.contracts.map((contract, index) => (
            <span key={contract.id}>
              {index > 0 ? ", " : ""}
              <Link href={`/contracts/${contract.id}?tab=assets`}>{contract.number}</Link>
            </span>
          ))}{" "}
          first. An asset on an open contract cannot become inactive.
          {info.contracts.some((contract) => contract.assetName) ? (
            <>
              {" "}
              Affected: {[...new Set(info.contracts.map((contract) => contract.assetName).filter(Boolean))].join(", ")}.
            </>
          ) : null}
        </>
      );
      break;
    case "serial_in_use":
      body = (
        <>
          Serial number <strong>{info.serialNumber}</strong> is already used by{" "}
          <Link href={`/assets/${info.asset.id}`}>{info.asset.name}</Link>
          {info.client ? (
            <>
              {" "}
              (<Link href={`/clients/${info.client.id}`}>{info.client.name}</Link>)
            </>
          ) : null}
          . Another active asset of the same model cannot have the same serial number.
        </>
      );
      break;
    case "previous_asset_has_successor":
      body = (
        <>
          That asset already has a successor: <Link href={`/assets/${info.asset.id}`}>{info.asset.name}</Link>. Choose
          another previous asset.
        </>
      );
      break;
    case "asset_client_immutable":
      body = ASSET_CLIENT_MOVE_MESSAGE;
      break;
  }
  return (
    <WebCard title="Not saved">
      <div className="web-dialog-summary" data-tone="warning" role="alert">
        {body}
      </div>
    </WebCard>
  );
}

/** "This serial number belongs to inactive asset <x> (<client>). Link it as previous asset?" */
export function PreviousAssetSuggestion({
  match,
  onLink,
}: {
  match: InactiveAssetOption;
  onLink: (match: InactiveAssetOption) => void;
}) {
  return (
    <WebCard title="Possible previous asset">
      <div className="web-dialog-summary" data-tone="info">
        This serial number belongs to inactive asset <Link href={`/assets/${match.id}`}>{match.name}</Link> (
        {match.client.name}). Link it as previous asset?{" "}
        <WebButton size="filter" onClick={() => onLink(match)}>
          Link as previous asset
        </WebButton>
      </div>
    </WebCard>
  );
}
