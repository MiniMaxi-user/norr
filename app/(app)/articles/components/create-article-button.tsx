"use client";

import { useState } from "react";
import { Button } from "@yourorg/ui";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { FlattenedArticleGroup } from "../group-tree";
import { ArticleFormPanel } from "./article-form-panel";

export interface CreateArticleButtonProps {
  groups: FlattenedArticleGroup[];
  units: ReferenceListItemRecord[];
  manufacturers: ReferenceListItemRecord[];
  vatRates: ReferenceListItemRecord[];
}

/** Owner/administratie "Add article" trigger — opens the slide-in
 * `ArticleFormPanel` (issue #92's own "New/Edit is the same slide-in
 * screen") in create mode. A `"use client"` component (owns the panel's
 * `open` state), same shape `CreateAssetButton` uses. */
export function CreateArticleButton({ groups, units, manufacturers, vatRates }: CreateArticleButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        Add article
      </Button>
      <ArticleFormPanel
        mode="create"
        groups={groups}
        units={units}
        manufacturers={manufacturers}
        vatRates={vatRates}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
