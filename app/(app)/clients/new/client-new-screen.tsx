"use client";

import { useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import { SidebarSection, WebDetailLayout, WebPage } from "@yourorg/ui/web";
import { EditDiscardDialog, PageHeader, useEditMode, webTabIds } from "@yourorg/ui/web-client";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { ClientOverviewCards } from "../components/client-overview-cards";
import { emptyDraft, type ClientDraft } from "../components/client-draft";
import { articleOptionLabel, buildClientSchema, createClientFromDraft } from "../components/client-form-schema";

export interface ClientNewScreenProps {
  accountManagers: AccountManagerRecord[];
  articles: ArticleSelectOption[];
  /** Server-computed `YYYY-MM-DD` "today" — the default "Client since", same
   * reasoning the old create screen documented (server date, not the
   * visitor's local one). */
  todayIso: string;
}

/**
 * `/clients/new` — the SAME page as a client's detail page, in `mode="new"`
 * (design system, issue #222: "Nieuw aanmaken = dezelfde pagina, direct in
 * bewerkmodus"). Only the Overview tab exists; the rail shows an "After
 * creating" explanation and an empty timeline note. A top-level module's own
 * record gets a real page, never a dialog (docs/ARCHITECTURE.md "Popup vs.
 * full page"). Replaces the old separate create screen.
 *
 * Creation goes through the existing `createClient` / `updateClientRateSettings`
 * server actions (`createClientFromDraft`) — `can(actor, "clients", "create")`
 * is still enforced by the action itself and by `new/page.tsx` before this
 * renders. Like before, a first Site is not collected here: it is added from
 * the new client's Sites tab. The logo can't be uploaded yet either (it needs
 * the client's id); it is set in edit mode afterwards.
 */
export function ClientNewScreen({ accountManagers, articles, todayIso }: ClientNewScreenProps) {
  const router = useRouter();
  const record = useMemo(() => emptyDraft(todayIso), [todayIso]);
  const schema = useMemo(
    () =>
      buildClientSchema({
        accountManagerLabel: (id) => {
          const manager = accountManagers.find((item) => item.id === id);
          return manager ? `${manager.first_name} ${manager.last_name}`.trim() : "";
        },
        articleLabel: (id) => {
          const article = articles.find((item) => item.id === id);
          return article ? articleOptionLabel(article) : "";
        },
      }),
    [accountManagers, articles],
  );
  // A second Save after a half-successful create must not create a duplicate.
  const createdIdRef = useRef<string | null>(null);

  const edit = useEditMode<ClientDraft>({
    record,
    schema,
    initialMode: "new",
    idPrefix: "client",
    firstFieldKey: "name",
    navigate: (href) => router.push(href),
    onCancelNew: () => router.push("/clients"),
    onSave: async (draft) => {
      if (createdIdRef.current) {
        router.push(`/clients/${createdIdRef.current}`);
        return { ok: true };
      }
      const { result, clientId, partial } = await createClientFromDraft(draft);
      if (partial && clientId) {
        // The client exists but its rate block failed: send the user to it
        // (a duplicate create would be worse) and say what is left to do.
        createdIdRef.current = clientId;
        toast({
          title: "Client created",
          description: "The rate settings could not be saved. Open Edit and set the custom rate again.",
          tone: "danger",
          duration: 8000,
        });
        router.push(`/clients/${clientId}`);
        return { ok: true };
      }
      if (!result.ok || !clientId) return result;
      createdIdRef.current = clientId;
      toast({ title: "Client created", tone: "success", duration: 3000 });
      router.push(`/clients/${clientId}`);
      return { ok: true };
    },
  });

  const ids = webTabIds("overview");

  return (
    <WebPage>
      <WebDetailLayout
        header={
          <PageHeader
            breadcrumb={[{ label: "Clients", href: "/clients" }, { label: "New client" }]}
            title="New client"
            mode="new"
            actions={{
              canEdit: false,
              onEdit: () => undefined,
              onSave: () => void edit.save(),
              onCancel: edit.requestCancel,
              saving: edit.saving,
              saveLabel: "Create client",
            }}
            tabs={[{ id: "overview", label: "Overview" }]}
            activeTab="overview"
            tabsLabel="Client sections"
            editStatus={edit.status}
          />
        }
        rail={
          <SidebarSection title="After creating">
            <p className="web-rail-empty">
              The client opens on its own page. Add its sites, contacts and contracts from the tabs there.
            </p>
          </SidebarSection>
        }
        timeline={{ items: [], emptyText: "The timeline starts once this record is created." }}
        mainProps={{ role: "tabpanel", id: ids.panel, "aria-labelledby": ids.tab }}
      >
        <ClientOverviewCards edit={edit} accountManagers={accountManagers} articles={articles} derived={{ address: null, phone: null }} isNew />
      </WebDetailLayout>
      <EditDiscardDialog confirm={edit.confirm} />
    </WebPage>
  );
}
