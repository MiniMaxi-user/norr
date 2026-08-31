import { redirect } from "next/navigation";

/**
 * `/settings/reference-lists` no longer has its own board (see
 * `./[listKey]/page.tsx`, issue #110 Settings admin shell stage 2) — old
 * bookmarks/links to the bare route land on the first leaf instead of
 * erroring or rendering a now-unlinked page.
 */
export default function ReferenceListsIndexPage() {
  redirect("/settings/reference-lists/asset_type");
}
