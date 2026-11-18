import type { LivePanelData } from "@yourorg/ui/web-client";
import type { AssetRecord } from "../actions";

/** The signed-in viewer (see the client page's twin of this function). */
export interface LivePanelViewer {
  userId: string;
}

/**
 * LivePanel of the Asset page — deliberately returns `null`.
 *
 * An asset has no running timer, no SLA and no approval waiting for the
 * current user; the page only has data that fails the three "when" tests of
 * the LivePanel rules (running right now / hard deadline close or passed / the
 * user must act now):
 *  - a warranty that ends in a few months is a gold notice in the rail's
 *    "Warranty & contract" section, not a LivePanel;
 *  - "no contract" and open work orders are badges;
 *  - meter readings are history, not a measurement in progress.
 * When asset-level inspection deadlines or running readings exist as data,
 * add the trigger HERE (and keep it at most one panel, highest priority
 * first).
 */
export function getLivePanel(_asset: AssetRecord | undefined, _viewer: LivePanelViewer | null): LivePanelData | null {
  void _asset;
  void _viewer;
  return null;
}
