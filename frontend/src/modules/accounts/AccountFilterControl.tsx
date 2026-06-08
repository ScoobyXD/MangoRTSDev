import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EVENT_ACCOUNTS_UPDATED,
  listAccounts,
  sortAccountsByName,
  type Account,
  type AccountsUpdatedDetail,
} from "./accountsApi.js";

type UseCompanyAccountsResult = {
  accounts: Account[];
  loading: boolean;
  error: string;
  reload: () => void;
  setAccounts: React.Dispatch<React.SetStateAction<Account[]>>;
};

export function useCompanyAccounts(companyID: string, enabled = true): UseCompanyAccountsResult {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestIDRef = useRef(0);

  const reload = useCallback(() => {
    const cleanCompanyID = companyID.trim();
    if (!enabled || !cleanCompanyID) {
      setAccounts([]);
      setLoading(false);
      setError("");
      return;
    }
    const requestID = requestIDRef.current + 1;
    requestIDRef.current = requestID;
    setLoading(true);
    listAccounts(cleanCompanyID)
      .then((next) => {
        if (requestIDRef.current !== requestID) return;
        setAccounts(next);
        setError("");
      })
      .catch((loadError) => {
        if (requestIDRef.current !== requestID) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load accounts");
        setAccounts([]);
      })
      .finally(() => {
        if (requestIDRef.current === requestID) setLoading(false);
      });
  }, [companyID, enabled]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onAccountsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<AccountsUpdatedDetail>).detail;
      const eventCompanyID = detail?.companyID?.trim() ?? "";
      if (eventCompanyID && eventCompanyID !== companyID.trim()) return;
      reload();
    };
    window.addEventListener(EVENT_ACCOUNTS_UPDATED, onAccountsUpdated);
    return () => window.removeEventListener(EVENT_ACCOUNTS_UPDATED, onAccountsUpdated);
  }, [companyID, enabled, reload]);

  return { accounts, loading, error, reload, setAccounts };
}

export function accountLabel(account: Pick<Account, "account_id" | "name">): string {
  return account.name.trim() || account.account_id;
}

export function accountSearchText(account: Account): string {
  return `${account.name} ${account.account_id}`.toLowerCase();
}

export function selectedAccountLabels(accounts: Account[], selectedAccountIDs: Iterable<string>): Account[] {
  const byID = new Map(accounts.map((account) => [account.account_id, account]));
  return Array.from(selectedAccountIDs)
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => byID.get(id) ?? {
      company_id: "",
      account_id: id,
      name: id,
      created_timestamp: "",
    })
    .filter((account, index, list) => list.findIndex((item) => item.account_id === account.account_id) === index);
}

export function AccountFilterControl({
  accounts,
  selectedAccountIDs,
  onChange,
  label = "Accounts",
  placeholder = "Search accounts",
  disabled = false,
  compact = false,
  showLabel = true,
  style,
}: {
  accounts: Account[];
  selectedAccountIDs: string[];
  onChange: (accountIDs: string[]) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
  showLabel?: boolean;
  style?: React.CSSProperties;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selected = useMemo(() => selectedAccountLabels(accounts, selectedAccountIDs), [accounts, selectedAccountIDs]);
  const selectedSet = useMemo(() => new Set(selectedAccountIDs.map((id) => id.trim()).filter(Boolean)), [selectedAccountIDs]);
  const normalizedQuery = query.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const sorted = sortAccountsByName(accounts).filter((account) => !selectedSet.has(account.account_id));
    if (!normalizedQuery) return sorted.slice(0, 8);
    return sorted.filter((account) => accountSearchText(account).includes(normalizedQuery)).slice(0, 8);
  }, [accounts, normalizedQuery, selectedSet]);
  const open = focused && !disabled && (normalizedQuery.length > 0 || suggestions.length > 0);

  useEffect(() => {
    if (!focused) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current?.contains(event.target as Node)) return;
      setFocused(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [focused]);

  const commitSelected = useCallback((ids: string[]) => {
    onChange(Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean))));
  }, [onChange]);

  const addAccount = useCallback((accountID: string) => {
    commitSelected([...selectedAccountIDs, accountID]);
    setQuery("");
    setFocused(false);
  }, [commitSelected, selectedAccountIDs]);

  const removeAccount = useCallback((accountID: string) => {
    commitSelected(selectedAccountIDs.filter((id) => id !== accountID));
  }, [commitSelected, selectedAccountIDs]);

  return (
    <div ref={wrapperRef} style={{ ...accountFilterRootStyle(compact), ...style }}>
      {showLabel && <span style={accountFilterLabelStyle}>{label}</span>}
      <div style={accountFilterBoxStyle(focused, compact, disabled)}>
        {selected.map((account) => (
          <button
            key={account.account_id}
            type="button"
            title={`Remove ${accountLabel(account)}`}
            disabled={disabled}
            style={accountChipStyle(disabled)}
            onClick={() => removeAccount(account.account_id)}
          >
            <span style={accountChipTextStyle}>{accountLabel(account)}</span>
            <span aria-hidden="true" style={accountChipRemoveStyle}>x</span>
          </button>
        ))}
        <input
          value={query}
          disabled={disabled}
          placeholder={selected.length === 0 ? placeholder : ""}
          style={accountInputStyle(compact)}
          onFocus={() => setFocused(true)}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setFocused(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !query && selected.length > 0) {
              event.preventDefault();
              removeAccount(selected[selected.length - 1].account_id);
              return;
            }
            if (event.key === "Enter" && suggestions[0]) {
              event.preventDefault();
              addAccount(suggestions[0].account_id);
              return;
            }
            if (event.key === "Escape") setFocused(false);
          }}
        />
      </div>
      {open && (
        <div style={accountSuggestionsStyle}>
          {suggestions.length > 0 ? suggestions.map((account) => (
            <button
              key={account.account_id}
              type="button"
              style={accountSuggestionButtonStyle}
              onMouseDown={(event) => {
                event.preventDefault();
                addAccount(account.account_id);
              }}
            >
              <span style={accountSuggestionNameStyle}>{accountLabel(account)}</span>
              <span style={accountSuggestionIDStyle}>{account.account_id}</span>
            </button>
          )) : (
            <div style={accountSuggestionEmptyStyle}>No accounts</div>
          )}
        </div>
      )}
    </div>
  );
}

function accountFilterRootStyle(compact: boolean): React.CSSProperties {
  return {
    position: "relative",
    minWidth: compact ? 220 : 280,
    display: "grid",
    gap: compact ? 4 : 6,
    color: "#111827",
    fontFamily: "var(--mango-font-family)",
  };
}

const accountFilterLabelStyle: React.CSSProperties = {
  color: "#475569",
  fontSize: 10.5,
  fontWeight: 780,
  letterSpacing: 0,
};

function accountFilterBoxStyle(focused: boolean, compact: boolean, disabled: boolean): React.CSSProperties {
  return {
    minHeight: compact ? 32 : 38,
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 5,
    border: "1px solid rgba(255, 255, 255, 0.78)",
    borderRadius: 8,
    background: "linear-gradient(145deg, rgba(255, 255, 255, 0.95) 0%, rgba(247, 248, 252, 0.86) 100%)",
    boxShadow: focused
      ? "inset 3px 3px 7px rgba(174, 174, 192, 0.18), inset -3px -3px 7px rgba(255, 255, 255, 0.9), 0 0 0 1px rgba(20, 184, 166, 0.24)"
      : "inset 3px 3px 7px rgba(174, 174, 192, 0.16), inset -3px -3px 7px rgba(255, 255, 255, 0.88), 0 0 0 1px rgba(100, 116, 139, 0.08)",
    padding: compact ? "4px 7px" : "5px 8px",
    opacity: disabled ? 0.62 : 1,
  };
}

function accountChipStyle(disabled: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    maxWidth: "100%",
    minHeight: 24,
    display: "inline-grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 5,
    border: "1px solid rgba(100, 116, 139, 0.18)",
    borderRadius: 7,
    background: "linear-gradient(145deg, rgba(255,255,255,0.94), rgba(236, 253, 245, 0.76))",
    color: "#0f172a",
    cursor: disabled ? "default" : "pointer",
    font: "inherit",
    fontSize: 11,
    fontWeight: 760,
    padding: "2px 7px",
    boxShadow: "3px 3px 7px rgba(174, 174, 192, 0.16), -3px -3px 7px rgba(255, 255, 255, 0.82), inset 1px 1px 0 rgba(255, 255, 255, 0.82)",
  };
}

const accountChipTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const accountChipRemoveStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: 11,
  fontWeight: 900,
};

function accountInputStyle(compact: boolean): React.CSSProperties {
  return {
    flex: "1 1 96px",
    minWidth: 76,
    height: compact ? 22 : 25,
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#111827",
    font: "inherit",
    fontSize: compact ? 11 : 12,
    fontWeight: 650,
    padding: 0,
  };
}

const accountSuggestionsStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 80,
  top: "calc(100% + 6px)",
  left: 0,
  right: 0,
  maxHeight: 230,
  overflowY: "auto",
  display: "grid",
  gap: 4,
  border: "1px solid transparent",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255,255,255,0.97), rgba(247,248,252,0.94)) padding-box, linear-gradient(135deg, rgba(92,238,255,0.62), rgba(183,124,255,0.48)) border-box",
  padding: 5,
  boxShadow: "0 18px 42px rgba(15, 23, 42, 0.16), inset 1px 1px 0 rgba(255,255,255,0.86)",
};

const accountSuggestionButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 34,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  gap: 2,
  border: "1px solid transparent",
  borderRadius: 6,
  background: "transparent",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  textAlign: "left",
  padding: "6px 7px",
};

const accountSuggestionNameStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12,
  fontWeight: 780,
};

const accountSuggestionIDStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#64748b",
  fontSize: 10,
  fontWeight: 650,
};

const accountSuggestionEmptyStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: 11,
  fontWeight: 650,
  padding: "8px 9px",
};
