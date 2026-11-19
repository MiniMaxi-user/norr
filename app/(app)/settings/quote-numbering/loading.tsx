import { SettingsFormSkeleton } from "../components/settings-section-skeleton";

// Route-level Suspense fallback for `/settings/quote-numbering`: the real header plus a placeholder card.
export default function QuoteNumberingLoading() {
  return <SettingsFormSkeleton navKey="quote_numbering" />;
}
