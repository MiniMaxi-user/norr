import type { TimelineItem } from "@yourorg/ui/web";
import { formatDateTimeWeb } from "@/lib/format/web";
import type { ArticleComponentLineRecord, ArticleRecord } from "../actions";

const MAX_ITEMS = 8;

interface Event {
  id: string;
  at: string;
  title: string;
}

/**
 * The Article page's TIMELINE, built from data the page already loads (no new
 * fetch): the article's own created/changed stamps plus, for a composite, when
 * each component was added to its bill of materials. Newest first. The data has
 * no author, so no actor is shown.
 */
export function buildArticleTimeline(input: {
  article: ArticleRecord;
  components: ArticleComponentLineRecord[];
}): TimelineItem[] {
  const { article, components } = input;
  const events: Event[] = [{ id: "article-created", at: article.created_at, title: "Article created" }];

  const created = new Date(article.created_at).getTime();
  const updated = new Date(article.updated_at).getTime();
  if (Number.isFinite(created) && Number.isFinite(updated) && updated - created > 60_000) {
    events.push({ id: "article-updated", at: article.updated_at, title: "Details changed" });
  }

  for (const line of components) {
    events.push({
      id: `component-${line.id}`,
      at: line.created_at,
      title: `Component added · ${line.component_article?.article_number ?? "Unknown article"}`,
    });
  }

  return events
    .filter((event) => !Number.isNaN(new Date(event.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_ITEMS)
    .map<TimelineItem>((event, index) => ({
      id: event.id,
      title: event.title,
      at: formatDateTimeWeb(event.at),
      status: index === 0 ? "latest" : "default",
    }));
}
