const ACTIVE_COMPANY_KEY = "mangorts:active-company-id-v1";
const DEV_COMPANY_ID_PARTS = ["11111111", "1111", "1111", "1111", "111111111111"] as const;

export function getStoredActiveCompanyID(): string {
  return sessionStorage.getItem(ACTIVE_COMPANY_KEY)?.trim() ?? "";
}

export function getActiveCompanyID(): string {
  const stored = getStoredActiveCompanyID();
  if (stored) return stored;
  const configured = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim();
  if (configured) return configured;
  if (import.meta.env.DEV) return DEV_COMPANY_ID_PARTS.join("-");
  throw new Error("VITE_COMPANY_ID is required for production builds.");
}

export function setActiveCompanyID(companyID: string): void {
  const next = companyID.trim();
  if (!next) return;
  sessionStorage.setItem(ACTIVE_COMPANY_KEY, next);
}

