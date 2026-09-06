"use client";

import { useState } from "react";
import { Badge, Button, CompositionTree, Inline, SectionHeader, Skeleton, Stack, Text } from "@yourorg/ui";
import { Network } from "@yourorg/ui/icons";
import type { AssetComponentTreeNode } from "../components-actions";
import { useAssetCompositionTree } from "./use-asset-composition-tree";
import { AssetCompositeManageDialog } from "./asset-composite-manage-dialog";

export interface AssetCompositeSectionProps {
  assetId: string;
  assetName: string;
  readOnly?: boolean;
}

/**
 * "Composite assets" section (issue #125) — the product owner's ask: manage
 * an asset's multi-layer-deep composition (which assets it's built from,
 * and/or what it's itself installed inside), always shown as the WHOLE tree
 * from its true root down (never just this asset's own immediate parent/
 * children slice — see `getAssetCompositionTree`'s own doc comment), with
 * this asset visually unmistakable wherever it sits in that tree.
 *
 * `mode: "edit"` only (see `AssetScreen`'s own caller) — an asset needs to
 * exist first to have components, so this never renders in `mode: "create"`.
 * Managing the relationships themselves (add/remove/edit quantity) is a
 * popup (`AssetCompositeManageDialog`) per this issue's own acceptance
 * criteria and `docs/ARCHITECTURE.md`'s "Popup vs. full page" rule — this
 * section only ever renders the read-only tree plus the "Manage" trigger.
 */
export function AssetCompositeSection({ assetId, assetName, readOnly }: AssetCompositeSectionProps) {
  const { tree, currentAssetId, loading, error, refresh } = useAssetCompositionTree(assetId, true);
  const [managing, setManaging] = useState(false);

  return (
    <Stack gap="sm">
      <SectionHeader
        icon={Network}
        title="Composite assets"
        actions={
          !readOnly && (
            <Button type="button" variant="outline" size="sm" onClick={() => setManaging(true)}>
              Manage
            </Button>
          )
        }
      />

      {error && <Text tone="danger">{error}</Text>}

      {loading && !tree ? (
        <Stack gap="xs">
          <Skeleton height="2.75rem" />
          <Skeleton height="2.75rem" />
        </Stack>
      ) : tree ? (
        <CompositionTree
          root={tree}
          getChildren={(node) => node.children}
          getKey={(node) => node.asset.id}
          isCurrent={(node) => node.asset.id === currentAssetId}
          currentLabel="This asset"
          renderNode={(node) => <CompositeTreeNodeContent node={node} />}
        />
      ) : (
        !error && <Text tone="muted">This asset has no composition yet.</Text>
      )}

      {!readOnly && managing && (
        <AssetCompositeManageDialog
          open
          onOpenChange={setManaging}
          parentAssetId={assetId}
          parentAssetName={assetName}
          onChange={refresh}
        />
      )}
    </Stack>
  );
}

function CompositeTreeNodeContent({ node }: { node: AssetComponentTreeNode }) {
  return (
    <Inline gap="xs" align="center" wrap>
      <Text className="ui-row-title">{node.asset.name}</Text>
      {node.asset.serial_number && <Text tone="muted">{node.asset.serial_number}</Text>}
      {node.asset.asset_status && (
        <Badge color={node.asset.asset_status.color}>{node.asset.asset_status.label}</Badge>
      )}
      {node.quantity != null && <Badge variant="muted">×{node.quantity}</Badge>}
    </Inline>
  );
}
