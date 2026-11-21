import { WebCard, WebCardSection, WebDataTableEmpty } from "@yourorg/ui/web";
import { Text } from "@yourorg/ui";
import { ModuleToggleList } from "@/components/modules/module-toggle-list";
import { listDefaultModules, setDefaultModules } from "./actions";

/**
 * "Default modules for new tenants" (#246): the add-on bundle a newly created
 * tenant starts with. Same list and rules as the tenant Modules tab (#245).
 * Server Component loader; existing tenants are never affected.
 */
export async function DefaultModulesCard() {
  const result = await listDefaultModules();

  return (
    <>
      <WebCard title="Default modules for new tenants">
        <WebCardSection>
          <Text tone="muted">
            The modules a newly created tenant starts with. Changing this doesn&rsquo;t affect existing tenants &mdash;
            manage those on the tenant&rsquo;s own Modules tab.
          </Text>
        </WebCardSection>
      </WebCard>
      {result.data ? (
        <ModuleToggleList rows={result.data.rows} onSave={setDefaultModules} showSource={false} />
      ) : (
        <WebCard title="Modules">
          <WebDataTableEmpty>{result.error ?? "Could not load the default modules."}</WebDataTableEmpty>
        </WebCard>
      )}
    </>
  );
}
