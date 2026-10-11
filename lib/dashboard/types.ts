/**
 * Serializable fact rows shipped from the server (`./data.ts`) to the
 * cross-filtering dashboard screen. Deliberately flat and compact: the client
 * recomputes every widget from these rows (see `./compute.ts`), so the page
 * needs only one round of queries no matter how many filters are toggled.
 */

export interface DashboardWorkOrder {
  id: string;
  title: string;
  clientId: string | null;
  clientName: string;
  assetId: string | null;
  assetName: string | null;
  engineerId: string | null;
  engineerName: string;
  statusValue: string;
  statusLabel: string;
  statusColor: string | null;
  typeValue: string | null;
  typeLabel: string;
  typeColor: string | null;
  createdAt: string;
  scheduledAt: string | null;
  /** Completion time; falls back to a sensible proxy for done orders that never got `completed_at`. */
  doneAt: string | null;
  durationMinutes: number | null;
  /** Neither awaiting review, completed nor invoiced. */
  isOpen: boolean;
  isDone: boolean;
}

export interface DashboardActivity {
  id: string;
  typeValue: string;
  typeLabel: string;
  typeColor: string | null;
  statusValue: string;
  statusLabel: string;
  isOpen: boolean;
  clientId: string | null;
  clientName: string;
  assetId: string | null;
  assetName: string | null;
  assetModel: string | null;
  reportedAt: string;
  /** First line of the report text, truncated. */
  summary: string;
}

export interface DashboardQuoteLine {
  /** article id, or the lower-cased description for free-text lines. */
  key: string;
  name: string;
  quantity: number;
  revenue: number;
}

export interface DashboardQuote {
  id: string;
  status: "draft" | "invoiced";
  quoteType: "default" | "contract";
  isAutoDraft: boolean;
  clientId: string | null;
  clientName: string;
  /** Invoice date for invoiced quotes (invoices.generated_at when readable, else quote updated_at); created_at for drafts. */
  date: string;
  total: number;
  /** Portion of `total` whose lines carry a purchase price (basis for margin). */
  costedTotal: number;
  cost: number;
  invoiceNumber: string | null;
  lines: DashboardQuoteLine[];
}

export interface DashboardDataset {
  /** ISO timestamp the dataset was built; all "now" maths use this so SSR and client agree. */
  now: string;
  /** Earliest timestamp covered by the date-bounded queries. */
  windowStart: string;
  visible: {
    workOrders: boolean;
    activities: boolean;
    finance: boolean;
  };
  /** True when a query hit its row cap, so older figures may be understated. */
  truncated: boolean;
  workOrders: DashboardWorkOrder[];
  activities: DashboardActivity[];
  quotes: DashboardQuote[];
}
