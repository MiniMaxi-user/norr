"use client";

import Link from "next/link";
import { WebCard } from "@yourorg/ui/web";
import type { MissingBaselineReading } from "../actions";

export interface ContractBaselineCardProps {
  missing: MissingBaselineReading[];
}

/**
 * Draft-only card of the Overview tab (issue #270): every covered asset /
 * counter that still lacks a reading on or before the contract start date.
 * Each asset links to its Volumes tab, where the reading is entered. All
 * clear = the contract can be activated.
 */
export function ContractBaselineCard({ missing }: ContractBaselineCardProps) {
  if (missing.length === 0) {
    return (
      <WebCard title="Baseline readings">
        <p className="web-dialog-text">All baseline readings are present. This contract can be activated.</p>
      </WebCard>
    );
  }

  return (
    <WebCard title="Baseline readings required before activation" meta={String(missing.length)}>
      <p className="web-dialog-text">
        Enter a reading on or before the contract start date for each counter below, then activate the contract.
      </p>
      <ul className="web-dialog-text">
        {missing.map((row) => (
          <li key={`${row.assetId}|${row.volumeItemId}`}>
            <Link href={`/assets/${row.assetId}?tab=volumes`}>{row.assetName}</Link> – {row.counterLabel}
          </li>
        ))}
      </ul>
    </WebCard>
  );
}
