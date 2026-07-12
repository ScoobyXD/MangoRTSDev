import { apiFetchJSON, getAuthSessionCacheGeneration } from "../../auth/cognitoAuth.js";

export const EVENT_ACCOUNTS_UPDATED = "mangorts:accounts-updated";

export type Account = {
  company_id: string;
  account_id: string;
  name: string;
  folder_id?: string | null;
  position?: number;
  created_timestamp: string;
  updated_timestamp?: string;
};

export type AccountFolder = {
  company_id: string;
  folder_id: string;
  parent_folder_id?: string | null;
  name: string;
  position?: number;
  created_timestamp: string;
  updated_timestamp?: string;
};

export type NodeAccountAssignment = {
  company_id: string;
  node_id: string;
  account_id: string;
  account_name?: string;
  created_timestamp: string;
};

export type AccountBearingEntity = {
  accounts?: Account[] | null;
};

export type AccountsUpdatedDetail = {
  companyID?: string;
};

type CompanyAccountsCacheEntry = {
  authGeneration: number;
  expiresAt: number;
  value?: Account[];
  inflight?: Promise<Account[]>;
};

const COMPANY_ACCOUNTS_CACHE_TTL_MS = 30_000;
const companyAccountsCache = new Map<string, CompanyAccountsCacheEntry>();
const companyAccountsGeneration = new Map<string, number>();

function readCompanyAccountsGeneration(companyID: string): number {
  return companyAccountsGeneration.get(companyID) ?? 0;
}

function cloneAccounts(accounts: readonly Account[]): Account[] {
  return accounts.map((account) => ({ ...account }));
}

export function invalidateCompanyAccountsCache(companyID = ""): void {
  const cleanCompanyID = companyID.trim();
  if (!cleanCompanyID) {
    for (const companyKey of new Set([...companyAccountsCache.keys(), ...companyAccountsGeneration.keys()])) {
      companyAccountsGeneration.set(companyKey, readCompanyAccountsGeneration(companyKey) + 1);
    }
    companyAccountsCache.clear();
    return;
  }
  companyAccountsGeneration.set(cleanCompanyID, readCompanyAccountsGeneration(cleanCompanyID) + 1);
  companyAccountsCache.delete(cleanCompanyID);
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  return search.toString();
}

export function emitAccountsUpdated(companyID: string): void {
  invalidateCompanyAccountsCache(companyID);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AccountsUpdatedDetail>(EVENT_ACCOUNTS_UPDATED, {
    detail: { companyID: companyID.trim() },
  }));
}

export function sortAccountsByName(accounts: Account[]): Account[] {
  return accounts.slice().sort((left, right) => (
    (left.name || left.account_id).localeCompare(right.name || right.account_id, undefined, { numeric: true, sensitivity: "base" }) ||
    left.account_id.localeCompare(right.account_id)
  ));
}

export function sortAccountFolders(folders: AccountFolder[]): AccountFolder[] {
  return folders.slice().sort((left, right) => (
    Number(left.position ?? 0) - Number(right.position ?? 0) ||
    left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }) ||
    left.folder_id.localeCompare(right.folder_id)
  ));
}

export function accountIDsForEntity(entity: AccountBearingEntity | null | undefined): string[] {
  return Array.from(new Set((entity?.accounts ?? []).map((account) => account.account_id.trim()).filter(Boolean)));
}

export function entityMatchesAccountFilter(entity: AccountBearingEntity | null | undefined, selectedAccountIDs: Iterable<string>): boolean {
  const selected = new Set(Array.from(selectedAccountIDs, (id) => id.trim()).filter(Boolean));
  if (selected.size === 0) return true;
  const entityIDs = accountIDsForEntity(entity);
  return entityIDs.some((accountID) => selected.has(accountID));
}

export async function listAccounts(companyID: string): Promise<Account[]> {
  const cleanCompanyID = companyID.trim();
  const authGeneration = getAuthSessionCacheGeneration();
  const invalidationGeneration = readCompanyAccountsGeneration(cleanCompanyID);
  const cached = companyAccountsCache.get(cleanCompanyID);
  if (cached?.authGeneration === authGeneration && cached.value && cached.expiresAt > Date.now()) {
    return cloneAccounts(cached.value);
  }
  if (cached?.authGeneration === authGeneration && cached.inflight) {
    const accounts = await cached.inflight;
    if (getAuthSessionCacheGeneration() !== authGeneration || readCompanyAccountsGeneration(cleanCompanyID) !== invalidationGeneration) {
      throw new DOMException("The company accounts read became stale.", "AbortError");
    }
    return cloneAccounts(accounts);
  }
  const params = query({ company_id: cleanCompanyID });
  const inflight = apiFetchJSON<{ accounts?: Account[] }>(`/v1/accounts?${params}`)
    .then((payload) => sortAccountsByName(payload.accounts ?? []))
    .then((accounts) => {
      if (getAuthSessionCacheGeneration() === authGeneration
        && readCompanyAccountsGeneration(cleanCompanyID) === invalidationGeneration
        && companyAccountsCache.get(cleanCompanyID)?.inflight === inflight) {
        companyAccountsCache.set(cleanCompanyID, {
          authGeneration,
          expiresAt: Date.now() + COMPANY_ACCOUNTS_CACHE_TTL_MS,
          value: cloneAccounts(accounts),
        });
      }
      return accounts;
    })
    .catch((cause) => {
      if (companyAccountsCache.get(cleanCompanyID)?.inflight === inflight) companyAccountsCache.delete(cleanCompanyID);
      throw cause;
    });
  companyAccountsCache.set(cleanCompanyID, { authGeneration, expiresAt: 0, inflight });
  const accounts = await inflight;
  if (getAuthSessionCacheGeneration() !== authGeneration || readCompanyAccountsGeneration(cleanCompanyID) !== invalidationGeneration) {
    throw new DOMException("The company accounts read became stale.", "AbortError");
  }
  return cloneAccounts(accounts);
}

export async function createAccount(input: {
  companyID: string;
  name: string;
  accountID?: string;
  folderID?: string | null;
  position?: number;
}): Promise<Account> {
  const account = await apiFetchJSON<Account>("/v1/accounts", {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      account_id: input.accountID,
      name: input.name,
      folder_id: input.folderID || null,
      position: input.position,
    }),
  });
  emitAccountsUpdated(input.companyID);
  return account;
}

export async function updateAccount(input: {
  companyID: string;
  accountID: string;
  name: string;
  folderID?: string | null;
  position?: number;
}): Promise<Account> {
  const account = await apiFetchJSON<Account>(`/v1/accounts/${encodeURIComponent(input.accountID)}`, {
    method: "PUT",
    body: JSON.stringify({
      company_id: input.companyID,
      name: input.name,
      folder_id: input.folderID || null,
      position: input.position,
    }),
  });
  emitAccountsUpdated(input.companyID);
  return account;
}

export async function deleteAccount(companyID: string, accountID: string): Promise<void> {
  const params = query({ company_id: companyID.trim() });
  await apiFetchJSON<{ deleted_account_id?: string }>(`/v1/accounts/${encodeURIComponent(accountID)}?${params}`, {
    method: "DELETE",
  });
  emitAccountsUpdated(companyID);
}

export async function listAccountFolders(companyID: string): Promise<AccountFolder[]> {
  const params = query({ company_id: companyID.trim() });
  const payload = await apiFetchJSON<{ folders?: AccountFolder[] }>(`/v1/account-folders?${params}`);
  return sortAccountFolders(payload.folders ?? []);
}

export async function createAccountFolder(input: {
  companyID: string;
  name: string;
  folderID?: string;
  parentFolderID?: string | null;
  position?: number;
}): Promise<AccountFolder> {
  const folder = await apiFetchJSON<AccountFolder>("/v1/account-folders", {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      folder_id: input.folderID,
      parent_folder_id: input.parentFolderID || null,
      name: input.name,
      position: input.position,
    }),
  });
  emitAccountsUpdated(input.companyID);
  return folder;
}

export async function updateAccountFolder(input: {
  companyID: string;
  folderID: string;
  name: string;
  parentFolderID?: string | null;
  position?: number;
}): Promise<AccountFolder> {
  const folder = await apiFetchJSON<AccountFolder>(`/v1/account-folders/${encodeURIComponent(input.folderID)}`, {
    method: "PUT",
    body: JSON.stringify({
      company_id: input.companyID,
      name: input.name,
      parent_folder_id: input.parentFolderID || null,
      position: input.position,
    }),
  });
  emitAccountsUpdated(input.companyID);
  return folder;
}

export async function deleteAccountFolder(companyID: string, folderID: string): Promise<void> {
  const params = query({ company_id: companyID.trim() });
  await apiFetchJSON<{ deleted_folder_id?: string }>(`/v1/account-folders/${encodeURIComponent(folderID)}?${params}`, {
    method: "DELETE",
  });
  emitAccountsUpdated(companyID);
}

export async function listNodeAccountAssignments(companyID: string, nodeID: string): Promise<NodeAccountAssignment[]> {
  const params = query({ company_id: companyID.trim() });
  const payload = await apiFetchJSON<{ assignments?: NodeAccountAssignment[] }>(`/v1/nodes/${encodeURIComponent(nodeID)}/accounts?${params}`);
  return payload.assignments ?? [];
}

export async function setNodeAccountAssignments(input: {
  companyID: string;
  nodeID: string;
  accountIDs: string[];
}): Promise<{ node?: AccountBearingEntity; assignments?: NodeAccountAssignment[] }> {
  const payload = await apiFetchJSON<{ node?: AccountBearingEntity; assignments?: NodeAccountAssignment[] }>(`/v1/nodes/${encodeURIComponent(input.nodeID)}/accounts`, {
    method: "PUT",
    body: JSON.stringify({
      company_id: input.companyID,
      account_ids: Array.from(new Set(input.accountIDs.map((id) => id.trim()).filter(Boolean))),
    }),
  });
  emitAccountsUpdated(input.companyID);
  return payload;
}
