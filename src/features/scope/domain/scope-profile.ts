export type ScopeProfileInput = {
  scopeStatement: string;
  services: string;
  locations: string;
  informationTypes: string;
  dependencies: string;
  exclusions: string;
};

export function assessScopeProfile(input: ScopeProfileInput) {
  const gaps: string[] = [];
  if (!input.scopeStatement.trim()) gaps.push("Describe the ISMS boundary and intended outcomes.");
  if (!input.services.trim()) gaps.push("Describe the products, services, and processes in scope.");
  if (!input.locations.trim()) gaps.push("Record the people, offices, or remote-working locations in scope.");
  if (!input.informationTypes.trim()) gaps.push("Record the information types the ISMS protects.");
  if (!input.dependencies.trim()) gaps.push("Record the material suppliers and technology dependencies.");
  if (!input.exclusions.trim()) gaps.push("Record any exclusions and the documented reason for each one.");
  return gaps;
}
