/**
 * Human title of a contract page. A contract has no name column: the optional
 * external reference (shown on invoices) is the closest thing, the
 * system-assigned contract number the fallback.
 */
export function contractTitle(contract: { contract_number: string; external_reference?: string | null }): string {
  return contract.external_reference?.trim() || contract.contract_number;
}
