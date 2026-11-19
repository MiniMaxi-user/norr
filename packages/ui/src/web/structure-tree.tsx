"use client";
// StructureTree of the web design system (issue #222): one reusable tree for
// every parent/child structure (composite assets, article bills of material,
// location hierarchies). One card: toolbar in FilterBar style (search, expand
// / collapse all, count, add button), a column header, then the rows —
// indentation of 24px per level with 1px connector lines, a chevron button,
// the mono ID link, a description, a secondary mono value and fixed columns on
// the right (status, quantity, ··· menu). `role="tree"` with arrow-key
// navigation. Part of the `web-client` entry.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "../icons";
import { WebButton, WebCard } from "./primitives";
import { WebMenu, type WebMenuItem } from "./menu";
import { StatusText, type StatusTone } from "./data-table";

export interface StructureTreeNode {
  /** Unique within the tree. */
  id: string;
  /** The record's ID / name — mono, 600, the link to the record. */
  label: string;
  /** Description (body text), e.g. the model. */
  description?: string | null;
  /** Second value in mono, muted — serial number, supplier article number. */
  secondary?: string | null;
  /** Record page; omitted => plain text. Never used for the current record. */
  href?: string;
  /** Status as coloured text (never a badge). */
  status?: { label: string; tone?: StatusTone } | null;
  /** Already formatted ("2 pcs"); only shown when `showQuantity` is set. */
  quantity?: string | null;
  /** The record whose page this is: highlighted and marked. */
  isCurrent?: boolean;
  /** Row actions (··· menu): unlink, move, change quantity... */
  actions?: WebMenuItem[];
  children: StructureTreeNode[];
}

export interface StructureTreeProps {
  /** Card title = the tab name ("Structure", "Bill of materials"). */
  title: string;
  /** The roots (almost always exactly one). Empty = empty state. */
  nodes: StructureTreeNode[];
  /** Plural noun for count, meta and placeholder: "assets". */
  noun: string;
  /** Singular marker on the current row: "this asset". */
  currentLabel: string;
  /** What the chevron reveals: "components" → "Show components of X". */
  childNoun?: string;
  /** Header of the first column. */
  treeHeader?: string;
  statusHeader?: string;
  /** Show the quantity column (bills of material, composite assets). */
  showQuantity?: boolean;
  quantityHeader?: string;
  /** The toolbar's add button ("+ Link component"); omit without permission. */
  add?: ReactNode;
  /** Shown when the tree has no nodes. */
  emptyText: string;
  emptyAction?: ReactNode;
  /** Accessible name of the tree. */
  ariaLabel?: string;
}

interface Row {
  node: StructureTreeNode;
  depth: number;
  parentId: string | null;
  posInSet: number;
  setSize: number;
  /** For each ancestor level (1..depth): does that ancestor have more
   * siblings below it? Plus whether this node is the last child. */
  continues: boolean[];
  isLast: boolean;
}

/** From level 6 the tree stops indenting (the level number shows instead). */
const MAX_INDENT_DEPTH = 4;

function containsCurrent(node: StructureTreeNode): boolean {
  return Boolean(node.isCurrent) || node.children.some(containsCurrent);
}

function collectIds(nodes: StructureTreeNode[], into: Set<string> = new Set()) {
  for (const node of nodes) {
    into.add(node.id);
    collectIds(node.children, into);
  }
  return into;
}

function maxDepth(nodes: StructureTreeNode[]): number {
  let max = 0;
  for (const node of nodes) max = Math.max(max, 1 + maxDepth(node.children));
  return max;
}

/** Open by default: the path to the current record (and the current record
 * itself) and the first two levels; anything deeper starts closed. */
function defaultExpanded(nodes: StructureTreeNode[]): Set<string> {
  const open = new Set<string>();
  function walk(node: StructureTreeNode, depth: number) {
    if (node.children.length === 0) return;
    if (depth === 0 || node.isCurrent || containsCurrent(node)) open.add(node.id);
    for (const child of node.children) walk(child, depth + 1);
  }
  for (const root of nodes) walk(root, 0);
  return open;
}

function matches(node: StructureTreeNode, needle: string) {
  return [node.label, node.description, node.secondary].some((value) => value?.toLowerCase().includes(needle));
}

function Highlight({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  const index = text.toLowerCase().indexOf(needle);
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <strong className="web-tree-hit">{text.slice(index, index + needle.length)}</strong>
      {text.slice(index + needle.length)}
    </>
  );
}

export function StructureTree({
  title,
  nodes,
  noun,
  currentLabel,
  childNoun = "components",
  treeHeader = "Structure",
  statusHeader = "Status",
  showQuantity = false,
  quantityHeader = "Qty",
  add,
  emptyText,
  emptyAction,
  ariaLabel,
}: StructureTreeProps) {
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(nodes));
  const seen = useRef<Set<string>>(collectIds(nodes));
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  // After the data changed (link / unlink / refresh): open the defaults of
  // nodes that are new, leave what the user opened or closed alone.
  useEffect(() => {
    const fresh = defaultExpanded(nodes);
    const ids = collectIds(nodes);
    setExpanded((previous) => {
      let next: Set<string> | null = null;
      for (const id of fresh) {
        if (!seen.current.has(id) && !previous.has(id)) {
          next ??= new Set(previous);
          next.add(id);
        }
      }
      return next ?? previous;
    });
    seen.current = ids;
  }, [nodes]);

  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;

  // Visible rows: while searching only hits and their ancestors (shown
  // open); otherwise whatever the expanded set allows.
  const { rows, hitCount } = useMemo(() => {
    const result: Row[] = [];
    let hits = 0;

    function subtreeHasHit(node: StructureTreeNode): boolean {
      return matches(node, needle) || node.children.some(subtreeHasHit);
    }

    function walk(
      node: StructureTreeNode,
      depth: number,
      parentId: string | null,
      posInSet: number,
      setSize: number,
      continues: boolean[],
    ) {
      if (searching && matches(node, needle)) hits += 1;
      result.push({ node, depth, parentId, posInSet, setSize, continues, isLast: posInSet === setSize });
      if (!(searching ? true : expanded.has(node.id))) return;
      const shown = searching ? node.children.filter(subtreeHasHit) : node.children;
      shown.forEach((child, index) => {
        walk(child, depth + 1, node.id, index + 1, shown.length, [...continues, posInSet < setSize]);
      });
    }

    const shownRoots = searching ? nodes.filter(subtreeHasHit) : nodes;
    shownRoots.forEach((root, index) => walk(root, 0, null, index + 1, shownRoots.length, []));
    return { rows: result, hitCount: hits };
  }, [nodes, expanded, needle, searching]);

  const nodeCount = useMemo(() => collectIds(nodes).size, [nodes]);
  const levels = useMemo(() => maxDepth(nodes), [nodes]);

  const parentOf = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const row of rows) map.set(row.node.id, row.parentId);
    return map;
  }, [rows]);

  const currentId = useMemo(() => {
    let found: string | null = null;
    (function find(list: StructureTreeNode[]) {
      for (const node of list) {
        if (node.isCurrent) found = node.id;
        find(node.children);
      }
    })(nodes);
    return found;
  }, [nodes]);

  const focusableId = activeId && rows.some((row) => row.node.id === activeId)
    ? activeId
    : (currentId && rows.some((row) => row.node.id === currentId) ? currentId : rows[0]?.node.id) ?? null;

  const toggle = useCallback((id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function focusRow(id: string | undefined | null) {
    if (!id) return;
    setActiveId(id);
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)?.focus();
    });
  }

  function onRowKeyDown(event: ReactKeyboardEvent<HTMLDivElement>, row: Row, index: number) {
    // Keys typed inside the row's own link / buttons / menu stay theirs.
    if (event.target !== event.currentTarget) return;
    const hasChildren = row.node.children.length > 0;
    const open = searching ? true : expanded.has(row.node.id);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(rows[index + 1]?.node.id);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(rows[index - 1]?.node.id);
        break;
      case "Home":
        event.preventDefault();
        focusRow(rows[0]?.node.id);
        break;
      case "End":
        event.preventDefault();
        focusRow(rows[rows.length - 1]?.node.id);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (hasChildren && !open) toggle(row.node.id);
        else if (hasChildren && open) focusRow(rows[index + 1]?.node.id);
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (hasChildren && open && !searching) toggle(row.node.id);
        else focusRow(parentOf.get(row.node.id));
        break;
      case "Enter":
        if (row.node.href && !row.node.isCurrent) {
          event.preventDefault();
          router.push(row.node.href);
        }
        break;
      default:
    }
  }

  const expandAll = () => {
    const open = new Set<string>();
    (function walk(list: StructureTreeNode[]) {
      for (const node of list) {
        if (node.children.length > 0) open.add(node.id);
        walk(node.children);
      }
    })(nodes);
    setExpanded(open);
  };
  const collapseAll = () => setExpanded(new Set());

  // Keep the column header stuck right under the (possibly wrapped) toolbar.
  const [toolbarHeight, setToolbarHeight] = useState(51);
  useEffect(() => {
    const toolbar = stickyRef.current?.querySelector<HTMLElement>(".web-filterbar");
    if (!toolbar || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => setToolbarHeight(toolbar.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  const placeholder = `Search in structure…`;
  const countText = searching
    ? `${hitCount} ${hitCount === 1 ? "match" : "matches"}`
    : `${nodeCount} ${nodeCount === 1 ? noun.replace(/s$/, "") : noun}`;
  const meta = nodeCount > 0 ? `${nodeCount} ${noun} · ${levels} ${levels === 1 ? "level" : "levels"}` : undefined;

  return (
    <WebCard title={title} meta={meta}>
      <div
        className="web-tree"
        data-quantity={showQuantity ? "true" : undefined}
        style={{ "--web-tree-toolbar-h": `${toolbarHeight}px` } as CSSProperties}
      >
        <div className="web-tree-sticky" ref={stickyRef}>
          <div className="web-filterbar" role="search">
            <div className="web-filter-search">
              <Search aria-hidden />
              <input
                ref={searchRef}
                type="text"
                aria-label="Search in structure"
                placeholder={placeholder}
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query) {
                    event.stopPropagation();
                    setQuery("");
                  }
                }}
              />
              {query ? (
                <button type="button" className="web-filter-search-clear" aria-label="Clear search" onClick={() => setQuery("")}>
                  ×
                </button>
              ) : null}
            </div>
            <WebButton size="filter" onClick={expandAll} disabled={nodeCount === 0 || searching}>
              Expand all
            </WebButton>
            <WebButton size="filter" onClick={collapseAll} disabled={nodeCount === 0 || searching}>
              Collapse all
            </WebButton>
            <span className="web-filterbar-count" aria-live="polite">
              {countText}
            </span>
            {add}
          </div>
          {nodeCount > 0 ? (
            <div className="web-tree-head" aria-hidden="true">
              <span className="web-overline">{treeHeader}</span>
              <span className="web-overline">{statusHeader}</span>
              {showQuantity ? <span className="web-overline web-tree-qty">{quantityHeader}</span> : null}
              <span />
            </div>
          ) : null}
        </div>

        {nodeCount === 0 ? (
          <p className="web-table-empty">
            {emptyText} {emptyAction}
          </p>
        ) : rows.length === 0 ? (
          <p className="web-table-empty">
            No {noun} match “{query.trim()}”.{" "}
            <button type="button" className="web-rail-link" onClick={() => setQuery("")}>
              Clear search
            </button>
          </p>
        ) : (
          <div role="tree" aria-label={ariaLabel ?? title} ref={listRef} className="web-tree-list">
            {rows.map((row, index) => {
              const { node } = row;
              const hasChildren = node.children.length > 0;
              const open = searching ? true : expanded.has(node.id);
              const focusable = node.id === focusableId;
              const indent = Math.min(row.depth, MAX_INDENT_DEPTH);
              // Index 0 is the root, which draws no lines.
              const through = row.continues.slice(1);
              const lines = indent > 1 ? through.slice(Math.max(0, through.length - (indent - 1))) : [];
              const deep = row.depth + 1 >= 6;
              const inner = focusable ? 0 : -1;
              return (
                <div
                  key={node.id}
                  role="treeitem"
                  data-tree-id={node.id}
                  data-current={node.isCurrent ? "true" : undefined}
                  aria-level={row.depth + 1}
                  aria-setsize={row.setSize}
                  aria-posinset={row.posInSet}
                  aria-expanded={hasChildren ? open : undefined}
                  aria-selected={Boolean(node.isCurrent)}
                  aria-current={node.isCurrent ? "page" : undefined}
                  tabIndex={focusable ? 0 : -1}
                  className="web-tree-row"
                  onFocus={(event) => {
                    if (event.target === event.currentTarget) setActiveId(node.id);
                  }}
                  onKeyDown={(event) => onRowKeyDown(event, row, index)}
                >
                  <div className="web-tree-cell">
                    {indent > 0 ? (
                      <span className="web-tree-guides" aria-hidden="true">
                        {lines.map((continues, level) => (
                          <span key={level} className="web-tree-guide" data-line={continues ? "through" : "none"} />
                        ))}
                        <span className="web-tree-guide" data-line={row.isLast ? "elbow" : "tee"} />
                      </span>
                    ) : null}
                    {hasChildren ? (
                      <button
                        type="button"
                        className="web-tree-chevron"
                        tabIndex={inner}
                        aria-label={`${open ? "Hide" : "Show"} ${childNoun} of ${node.label}`}
                        aria-expanded={open}
                        disabled={searching}
                        onClick={() => toggle(node.id)}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                          <path d={open ? "M5 9l7 7 7-7" : "M9 5l7 7-7 7"} />
                        </svg>
                      </button>
                    ) : (
                      <span className="web-tree-chevron-space" aria-hidden="true" />
                    )}
                    {node.href && !node.isCurrent ? (
                      <Link href={node.href} className="web-tree-id" tabIndex={inner} title={node.label}>
                        <Highlight text={node.label} needle={needle} />
                      </Link>
                    ) : (
                      <span className="web-tree-id" data-plain="true" title={node.label}>
                        <Highlight text={node.label} needle={needle} />
                      </span>
                    )}
                    {node.description ? (
                      <span className="web-tree-desc" title={node.description}>
                        <Highlight text={node.description} needle={needle} />
                      </span>
                    ) : null}
                    {deep ? (
                      <span className="web-tree-secondary">lvl {row.depth + 1}</span>
                    ) : node.secondary ? (
                      <span className="web-tree-secondary" title={node.secondary}>
                        <Highlight text={node.secondary} needle={needle} />
                      </span>
                    ) : null}
                    {node.isCurrent ? <span className="web-tree-here">{currentLabel}</span> : null}
                  </div>
                  <span className="web-tree-status">
                    {node.status ? <StatusText display="auto" tone={node.status.tone}>{node.status.label}</StatusText> : null}
                  </span>
                  {showQuantity ? <span className="web-tree-qty">{node.quantity ?? ""}</span> : null}
                  <span className="web-tree-actions">
                    {node.actions && node.actions.length > 0 ? (
                      <WebMenu
                        label={`Actions for ${node.label}`}
                        triggerClassName="web-btn web-btn-icon web-row-actions"
                        triggerTabIndex={inner}
                        trigger={
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <circle cx="5" cy="12" r="1.8" />
                            <circle cx="12" cy="12" r="1.8" />
                            <circle cx="19" cy="12" r="1.8" />
                          </svg>
                        }
                        items={node.actions}
                      />
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </WebCard>
  );
}
