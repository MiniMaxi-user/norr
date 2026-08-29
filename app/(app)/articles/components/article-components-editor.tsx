"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Button, Combobox, FormGrid, Input, Label, Stack, Table, Text } from "@yourorg/ui";
import { listArticles, type ArticleRecord } from "../actions";
import { addArticleComponent, removeArticleComponent, updateArticleComponent } from "../components-actions";
import type { ArticleComponentLineRecord } from "../actions";

const CANDIDATE_FETCH_LIMIT = 200;

export interface ArticleComponentsEditorProps {
  parentArticleId: string;
  initialComponents: ArticleComponentLineRecord[];
}

/**
 * The bill-of-materials editor for a composite article (issue #92) — a
 * searchable component picker + quantity, an "Add component" action, and an
 * inline-editable/removable table of already-added components. Only ever
 * rendered once a real `parentArticleId` exists (see `ArticleFormPanel`'s own
 * doc comment on the create-mode BOM-editing approach) — `ArticleFormPanel`
 * only ever mounts this component fresh (conditional rendering, never a prop
 * update on an already-mounted instance), so its own `useEffect`s below don't
 * need an explicit reset trigger from the caller.
 *
 * The component picker is a `Combobox` (per this issue's acceptance
 * criteria) backed by this org's non-composite articles — fetched ONCE per
 * panel open (`listArticles({ isComposite: false, limit: 200 })`), not
 * re-queried per keystroke: `Combobox` (packages/ui/src/combobox.tsx) is a
 * "caller passes the full option list, component filters client-side"
 * primitive with no per-keystroke callback to hang a live server search off
 * of (same contract `AssetModelFormDialog`'s Brand/Type/Sub-type pickers
 * already rely on) — extending that shared primitive with a remote-search
 * mode is a bigger cross-cutting change than this task's scope, so a
 * generous fixed-size fetch is the pragmatic fit here. A catalog with more
 * than 200 non-composite articles would need that follow-up; flagged here
 * rather than silently working around it.
 */
export function ArticleComponentsEditor({ parentArticleId, initialComponents }: ArticleComponentsEditorProps) {
  const [components, setComponents] = useState<ArticleComponentLineRecord[]>(initialComponents);
  const [candidates, setCandidates] = useState<ArticleRecord[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [selectedComponentId, setSelectedComponentId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [adding, startAdding] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingCandidates(true);
    listArticles({ isComposite: false, limit: CANDIDATE_FETCH_LIMIT })
      .then((result) => {
        if (cancelled) return;
        setCandidates(result.data?.articles ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingCandidates(false);
      });
    return () => {
      cancelled = true;
    };
    // Runs once on mount only — this component is only ever mounted fresh
    // (see the doc comment above), never reused across a different
    // `parentArticleId` via a prop update. Nothing reactive is referenced
    // inside this effect, so an empty deps array needs no exhaustive-deps
    // override here.
  }, []);

  const addedComponentIds = useMemo(() => new Set(components.map((component) => component.component_article_id)), [components]);
  const options = useMemo(
    () =>
      candidates
        .filter((candidate) => candidate.id !== parentArticleId && !addedComponentIds.has(candidate.id))
        .map((candidate) => ({ value: candidate.id, label: `${candidate.article_number} — ${candidate.description}` })),
    [candidates, parentArticleId, addedComponentIds],
  );

  function handleAdd() {
    if (!selectedComponentId) {
      setError("Select a component article.");
      return;
    }
    const parsedQuantity = Number(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    setError(null);
    startAdding(async () => {
      const result = await addArticleComponent(parentArticleId, {
        componentArticleId: selectedComponentId,
        quantity: parsedQuantity,
      });
      if (!result.data) {
        setError(result.error ?? "Could not add this component.");
        return;
      }
      setComponents((current) => [...current, result.data!.component]);
      setSelectedComponentId("");
      setQuantity("1");
    });
  }

  async function handleRemove(component: ArticleComponentLineRecord) {
    setError(null);
    const result = await removeArticleComponent(component.id);
    if (result.error) {
      setError(result.error);
      return;
    }
    setComponents((current) => current.filter((item) => item.id !== component.id));
  }

  function handleQuantityChange(componentId: string, quantity: number) {
    setComponents((current) => current.map((item) => (item.id === componentId ? { ...item, quantity } : item)));
  }

  return (
    <Stack gap="sm">
      {error && <Text tone="danger">{error}</Text>}

      {components.length === 0 ? (
        <Text tone="muted">No components added yet.</Text>
      ) : (
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>Article</Table.HeaderCell>
              <Table.HeaderCell>Description</Table.HeaderCell>
              <Table.HeaderCell>Quantity</Table.HeaderCell>
              <Table.HeaderCell>Unit</Table.HeaderCell>
              <Table.HeaderCell align="center">Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {components.map((component) => (
              <ComponentRow
                key={component.id}
                component={component}
                onRemove={handleRemove}
                onQuantityChange={handleQuantityChange}
              />
            ))}
          </Table.Body>
        </Table>
      )}

      <FormGrid columns={3}>
        <Stack gap="xs">
          <Label htmlFor="bom-component">Add component</Label>
          <Combobox
            id="bom-component"
            options={options}
            value={selectedComponentId}
            onChange={setSelectedComponentId}
            placeholder={loadingCandidates ? "Loading articles…" : "Search articles…"}
            disabled={loadingCandidates}
            clearable
            emptyMessage="No matching non-composite articles."
          />
        </Stack>
        <Stack gap="xs">
          <Label htmlFor="bom-quantity">Quantity</Label>
          <Input
            id="bom-quantity"
            type="number"
            min="0.001"
            step="0.001"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Stack>
        <Stack gap="xs">
          <Label>&nbsp;</Label>
          <Button type="button" variant="outline" onClick={handleAdd} disabled={adding || loadingCandidates}>
            {adding ? "Adding…" : "Add component"}
          </Button>
        </Stack>
      </FormGrid>
    </Stack>
  );
}

function ComponentRow({
  component,
  onRemove,
  onQuantityChange,
}: {
  component: ArticleComponentLineRecord;
  onRemove: (component: ArticleComponentLineRecord) => void;
  onQuantityChange: (componentId: string, quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState(String(component.quantity));
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    const parsed = Number(quantity);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed === component.quantity) {
      setQuantity(String(component.quantity));
      return;
    }
    setSaving(true);
    setError(null);
    const result = await updateArticleComponent(component.id, { quantity: parsed });
    setSaving(false);
    if (!result.data) {
      setError(result.error ?? "Could not update quantity.");
      setQuantity(String(component.quantity));
      return;
    }
    onQuantityChange(component.id, result.data.component.quantity);
  }

  async function handleRemoveClick() {
    setRemoving(true);
    await onRemove(component);
    setRemoving(false);
  }

  return (
    <Table.Row>
      <Table.Cell>{component.component_article?.article_number ?? "—"}</Table.Cell>
      <Table.Cell>{component.component_article?.description ?? "—"}</Table.Cell>
      <Table.Cell>
        <Stack gap="xs">
          <Input
            aria-label="Quantity"
            type="number"
            min="0.001"
            step="0.001"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            onBlur={commit}
            disabled={saving || removing}
          />
          {error && <Text tone="danger">{error}</Text>}
        </Stack>
      </Table.Cell>
      <Table.Cell>{component.component_article?.article_unit?.label ?? "—"}</Table.Cell>
      <Table.Cell align="center">
        <Button type="button" variant="danger" size="sm" onClick={handleRemoveClick} disabled={saving || removing}>
          {removing ? "Removing…" : "Remove"}
        </Button>
      </Table.Cell>
    </Table.Row>
  );
}
