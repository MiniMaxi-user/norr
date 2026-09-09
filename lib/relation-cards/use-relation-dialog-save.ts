"use client";

import { useState } from "react";

export interface RelationSaveResult {
  ok: boolean;
  error?: string;
}

/**
 * Shared `saving`/`error` state + save flow behind every relation card's
 * pencil dialog (issue #130) — `WorkOrderRelationsDialog`, `AssetRelations
 * Dialog`, `ActivityRelationsDialog`, `QuoteRelationsDialog`, and
 * `ContractClientDialog` all ran the literal same sequence: validate, call
 * the screen's own `commitPatch`-shaped `onSave(patch)` prop, close on
 * success, surface the returned error otherwise. Only the validation rule
 * and the patch shape are genuine per-module differences — both left to the
 * caller. See `resolve-relation.ts` (same folder) for the display-side half
 * of that same duplication.
 *
 * `onOpenChange` is the same prop every one of those dialogs already
 * receives to close itself, so `save()` closes through it directly on
 * success rather than returning a boolean for the caller to act on — the
 * least-invasive option per call site.
 */
export function useRelationDialogSave<T>(
  onSave: (patch: T) => Promise<RelationSaveResult>,
  onOpenChange: (open: boolean) => void,
) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: T, validate?: () => string | null | undefined) {
    const validationError = validate?.();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave(patch);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    onOpenChange(false);
  }

  return { saving, error, save };
}
