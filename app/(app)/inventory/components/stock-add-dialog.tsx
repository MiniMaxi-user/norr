"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@yourorg/ui";
import { WebButton, WebDataTable } from "@yourorg/ui/web";
import { addArticleToWarehouse, searchArticlesToAddToWarehouse, type WarehouseArticleSearchResult } from "../actions";
import { formatMoneyWeb } from "@/lib/format/web";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * "+ Article" dialog of the Stock tab (issue #181, web design system #222):
 * type-and-search against the org's active catalog
 * (`searchArticlesToAddToWarehouse`, which already leaves out articles this
 * warehouse holds), then "Add" puts an article in the warehouse at once
 * (`addArticleToWarehouse`). The dialog stays open so several articles can be
 * added in a row; added ones drop out of the results.
 */
export function StockAddDialog({ warehouseId, onClose }: { warehouseId: string; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WarehouseArticleSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    let cancelled = false;
    const timeout = setTimeout(async () => {
      const result = await searchArticlesToAddToWarehouse(warehouseId, trimmed);
      if (cancelled) return;
      setSearching(false);
      if (!result.data) {
        setError(result.error ?? "Could not search articles.");
        setResults([]);
        return;
      }
      setError(null);
      setResults(result.data.articles);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, warehouseId]);

  async function handleAdd(article: WarehouseArticleSearchResult) {
    setAddingId(article.id);
    setError(null);
    const result = await addArticleToWarehouse(warehouseId, article.id);
    setAddingId(null);
    if (!result.data) {
      setError(result.error ?? "Could not add this article.");
      return;
    }
    setResults((previous) => previous.filter((entry) => entry.id !== article.id));
    setAddedCount((count) => count + 1);
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()} size="sm">
      <Dialog.Header>
        <h2 className="web-dialog-title">Add article</h2>
      </Dialog.Header>
      <Dialog.Body>
        <div className="web-dialog-form">
          <div className="web-dialog-field">
            <label className="web-field-label" htmlFor="stock-add-search">
              Search the catalog
            </label>
            <input
              id="stock-add-search"
              className="web-input"
              type="search"
              autoFocus
              autoComplete="off"
              placeholder="Article number or description…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {error ? (
            <p className="web-dialog-error" role="alert">
              <span className="web-error-mark" aria-hidden="true">
                !
              </span>
              {error}
            </p>
          ) : null}
          {query.trim() ? (
            searching ? (
              <p className="web-rail-empty" aria-live="polite">
                Searching…
              </p>
            ) : results.length === 0 ? (
              <p className="web-rail-empty" aria-live="polite">
                No matching articles
              </p>
            ) : (
              <WebDataTable aria-label="Matching articles">
                <thead>
                  <tr>
                    <th scope="col">Article</th>
                    <th scope="col" data-numeric="true">
                      Sale price
                    </th>
                    <th scope="col">
                      <span className="web-sr-only">Add</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((article) => (
                    <tr key={article.id}>
                      <td>
                        <span data-id="true">{article.article_number}</span> · {article.description}
                      </td>
                      <td data-numeric="true">{formatMoneyWeb(article.sale_price)}</td>
                      <td>
                        <WebButton
                          size="sm"
                          loading={addingId === article.id}
                          disabled={addingId !== null}
                          onClick={() => void handleAdd(article)}
                        >
                          Add
                        </WebButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </WebDataTable>
            )
          ) : null}
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <WebButton onClick={onClose}>{addedCount > 0 ? `Done · ${addedCount} added` : "Cancel"}</WebButton>
      </Dialog.Footer>
    </Dialog>
  );
}
