const ACTIVE_COMPANY_KEY = "mangorts:active-company-id-v1";

export function getStoredActiveCompanyID(): string {
  return sessionStorage.getItem(ACTIVE_COMPANY_KEY)?.trim() ?? "";
}

export function getActiveCompanyID(): string {
  const stored = getStoredActiveCompanyID();
  if (stored) return stored;
  return (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
}

export function setActiveCompanyID(companyID: string): void {
  const next = companyID.trim();
  if (!next) return;
  sessionStorage.setItem(ACTIVE_COMPANY_KEY, next);
}

