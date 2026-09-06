import type { ReactNode } from "react";
import { cx } from "../cx";

export interface CompositionTreeProps<T> {
  /** The root of the WHOLE tree to render — per this primitive's own
   * "always show the whole tree, not just a subtree" convention, this should
   * already be the true top-most node the caller resolved (e.g. an Asset's
   * composition-tree root, walked up from whatever asset the caller actually
   * cares about) — this component itself has no notion of "the node I was
   * asked about", that's what `isCurrent` is for. */
  root: T;
  /** This node's own direct children, in render order. Return an empty/
   * nullish value for a leaf. */
  getChildren: (node: T) => T[] | undefined | null;
  /** A stable React key for a node — must be unique across the WHOLE tree,
   * not just among siblings (a `Map`/array index alone won't do if the same
   * underlying record could theoretically recur — pass the record's own id). */
  getKey: (node: T) => string;
  /** The node's own card content — name/quantity/badges/whatever the caller
   * wants shown. Purely presentational; this component only supplies the
   * tree chrome (indentation + connector lines) around it. */
  renderNode: (node: T) => ReactNode;
  /** Marks this node as the one the caller actually cares about — gets an
   * accent border/background plus `currentLabel`'s badge, so it reads as
   * unmistakable at any depth (not just a subtle tint). Omit entirely if no
   * node should be marked. */
  isCurrent?: (node: T) => boolean;
  /** Badge text shown on the node `isCurrent` matches. Defaults to "Current"
   * — override per-domain (e.g. "This asset"/"This article"). */
  currentLabel?: ReactNode;
  /** Makes every node's card a clickable/keyboard-activatable control (e.g.
   * navigate to that record's own detail page). Omit for a purely
   * informational, non-interactive tree (the common case) — no roving-
   * tabindex/keyboard handling is wired up unless this is set, since a
   * static tree needs none: a screen reader already reads the underlying
   * `<ul>`/`<li>` list top-to-bottom correctly on its own. */
  onNodeClick?: (node: T) => void;
  className?: string;
}

/**
 * CompositionTree — a generic, arbitrary-depth ROOTED tree of cards with
 * classic file-explorer-style connector lines (indentation +
 * `::before`/`::after` "elbow" lines on each child, see `.ui-composition-tree-*`
 * in styles.css), built on real `<ul>`/`<li>` semantics so it stays a plain,
 * linearly screen-reader-navigable list rather than visual-only div soup.
 *
 * Generic over the node shape via `getChildren`/`getKey`/`renderNode` (a
 * render-prop composition, same spirit as `Timeline`'s `Row`/`Block`
 * sub-components, just structured as plain props here since the recursion
 * itself — not row/column composition — is this component's whole job).
 * First caller: an Asset's `asset_components` composition tree
 * (`AssetComponentTreeNode`, issue #125) via
 * `app/(app)/assets/components/asset-composite-section.tsx` — deliberately
 * has ZERO import of that (or any other app-level) type; a near-identical
 * Articles bill-of-materials follow-up reuses this exact primitive for its
 * own, differently-shaped node.
 *
 * An indentation-based layout (rather than an absolute-positioned org-chart
 * with SVG lines) was chosen because it stays correct at arbitrary depth/
 * width with no measurement/layout pass, and a deep-but-narrow tree (the
 * common "assembly built from sub-assemblies" shape) never needs horizontal
 * scroll — only vertical space grows.
 *
 * ```tsx
 * <CompositionTree
 *   root={tree}
 *   getChildren={(node) => node.children}
 *   getKey={(node) => node.asset.id}
 *   isCurrent={(node) => node.isCurrent}
 *   currentLabel="This asset"
 *   renderNode={(node) => (
 *     <Inline gap="sm" align="center">
 *       <Text>{node.asset.name}</Text>
 *       {node.quantity != null && <Badge>×{node.quantity}</Badge>}
 *     </Inline>
 *   )}
 * />
 * ```
 */
export function CompositionTree<T>({
  root,
  getChildren,
  getKey,
  renderNode,
  isCurrent,
  currentLabel = "Current",
  onNodeClick,
  className,
}: CompositionTreeProps<T>) {
  return (
    <ul className={cx("ui-composition-tree", className)}>
      <CompositionTreeNode
        node={root}
        getChildren={getChildren}
        getKey={getKey}
        renderNode={renderNode}
        isCurrent={isCurrent}
        currentLabel={currentLabel}
        onNodeClick={onNodeClick}
      />
    </ul>
  );
}

interface CompositionTreeNodeProps<T> {
  node: T;
  getChildren: (node: T) => T[] | undefined | null;
  getKey: (node: T) => string;
  renderNode: (node: T) => ReactNode;
  isCurrent?: (node: T) => boolean;
  currentLabel: ReactNode;
  onNodeClick?: (node: T) => void;
}

function CompositionTreeNode<T>({
  node,
  getChildren,
  getKey,
  renderNode,
  isCurrent,
  currentLabel,
  onNodeClick,
}: CompositionTreeNodeProps<T>) {
  const children = getChildren(node) ?? [];
  const current = isCurrent?.(node) ?? false;
  const interactive = Boolean(onNodeClick);

  return (
    <li className="ui-composition-tree-node">
      <div
        className={cx(
          "ui-composition-tree-card",
          current && "ui-composition-tree-card-current",
          interactive && "ui-composition-tree-card-clickable",
        )}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={interactive ? () => onNodeClick!(node) : undefined}
        onKeyDown={
          interactive
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onNodeClick!(node);
                }
              }
            : undefined
        }
      >
        <span className="ui-composition-tree-card-content">{renderNode(node)}</span>
        {current && <span className="ui-composition-tree-current-badge">{currentLabel}</span>}
      </div>
      {children.length > 0 && (
        <ul className="ui-composition-tree-children">
          {children.map((child) => (
            <CompositionTreeNode
              key={getKey(child)}
              node={child}
              getChildren={getChildren}
              getKey={getKey}
              renderNode={renderNode}
              isCurrent={isCurrent}
              currentLabel={currentLabel}
              onNodeClick={onNodeClick}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
