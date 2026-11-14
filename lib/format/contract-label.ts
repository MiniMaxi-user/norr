/**
 * Display label for a contract (issue #216): the system-assigned contract
 * number is the primary identifier, the optional external reference is
 * secondary - "CON2872 · External ref".
 */
export function contractLabel(contract: { contract_number: string; external_reference?: string | null }): string {
  return contract.external_reference
    ? `${contract.contract_number} · ${contract.external_reference}`
    : contract.contract_number;
}
