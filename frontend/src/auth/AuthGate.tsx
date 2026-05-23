import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { preloadHomeSurface, preloadLikelyDashboardModules, preloadLogicGateArenaSurface } from "../app/preloadDashboardModules";
import { HeaderSettingsIcon } from "../app/HeaderIcons";
import { MangoWordmark } from "../app/MangoLogo";
import { getActiveCompanyID, getStoredActiveCompanyID, setActiveCompanyID } from "./currentCompany";
import {
  acceptInvitation,
  apiFetchJSON,
  changePassword,
  completeNewPassword,
  fetchCurrentUser,
  formatAuthError,
  forgotPassword,
  hasStoredToken,
  isAuthEnabled,
  loginWithPassword,
  logout,
  resetPassword,
  validateInvitationToken,
  type CurrentUserResponse,
  type LoginResult,
} from "./cognitoAuth";
import { isAuthPath, nextPathForAuthState } from "./authRoutes";

type PendingChallenge = Extract<LoginResult, { status: "new_password_required" }> | null;
type AppLayoutModule = typeof import("../app/applayout");

let appLayoutPromise: Promise<AppLayoutModule> | null = null;

function loadAppLayout() {
  appLayoutPromise ??= import("../app/applayout");
  return appLayoutPromise;
}

function preloadAppLayout(): void {
  void loadAppLayout();
}

const LazyAppLayout = React.lazy(() => loadAppLayout().then((module) => ({ default: module.default })));
const routeFallback = <div aria-busy="true" style={{ width: "100vw", height: "100vh", background: "#ffffff" }} />;

function preloadAuthenticatedShell(): void {
  preloadAppLayout();
  preloadLikelyDashboardModules();
}

function preloadRouteSurface(path: string): void {
  if (path === "/logic-gate-arena") {
    preloadLogicGateArenaSurface();
    return;
  }
  if (path === "/home" || path === "/communication" || path === "/communications") preloadHomeSurface();
}
function prefetchHandlers(preload: () => void) {
  return {
    onPointerEnter: preload,
    onFocus: preload,
    onPointerDown: preload,
  };
}

const logicGateArenaPrefetch = prefetchHandlers(preloadLogicGateArenaSurface);
const homePrefetch = prefetchHandlers(preloadHomeSurface);

type CompanyUser = {
  company_id: string;
  user_id: string;
  email: string;
  display_name?: string;
  role: string;
};

type CompanyUserGroup = {
  company_id: string;
  group_id: string;
  parent_group_id?: string;
  name: string;
  position: number;
};

type CompanyUserGroupMember = {
  company_id: string;
  group_id: string;
  user_id: string;
  user_display_name?: string;
  user_email?: string;
};

const PASSWORD_RESET_SECONDS = 60 * 60;

type Company = {
  company_id: string;
  name: string;
};

type CompanyOption = Company & {
  role?: string;
};

type SettingsSelectOption = {
  value: string;
  label: string;
  detail?: string;
};

const INVITE_ROLE_OPTIONS: SettingsSelectOption[] = [
  { value: "company_user", label: "company_user" },
  { value: "company_admin", label: "company_admin" },
];

const COMPANY_SEARCH_LIMIT = 100;

const panelStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "#ffffff",
  color: "#111827",
  fontFamily: "var(--mango-font-family)",
};

const formStyle: React.CSSProperties = {
  width: "min(420px, calc(100vw - 32px))",
  display: "grid",
  gap: 12,
  padding: 18,
  border: "1px solid rgba(100, 116, 139, 0.35)",
  background: "#ffffff",
  borderRadius: 8,
  boxShadow: "0 12px 34px rgba(15, 23, 42, 0.12)",
};

const inputStyle: React.CSSProperties = {
  height: 38,
  border: "1px solid rgba(100, 116, 139, 0.35)",
  borderRadius: 6,
  padding: "0 10px",
  font: "inherit",
};

const buttonStyle: React.CSSProperties = {
  height: 38,
  border: "1px solid #334155",
  borderRadius: 6,
  background: "var(--mango-gradient)",
  color: "#111827",
  cursor: "pointer",
  fontWeight: 600,
};

export default function AuthGate() {
  const authEnabled = isAuthEnabled();
  const [path, setPath] = useState(() => window.location.pathname);
  const [me, setMe] = useState<CurrentUserResponse | null>(null);
  const [loading, setLoading] = useState(authEnabled && hasStoredToken());
  const [error, setError] = useState("");
  const [pendingChallenge, setPendingChallenge] = useState<PendingChallenge>(null);

  const navigate = useCallback((nextPath: string) => {
    const normalizedNextPath = nextPath.trim() || "/";
    preloadRouteSurface(normalizedNextPath);
    if (window.location.pathname !== normalizedNextPath) {
      window.history.pushState({}, "", normalizedNextPath);
    }
    setPath(normalizedNextPath);
  }, []);

  const loadMe = useCallback(async () => {
    if (!authEnabled) return;
    preloadAuthenticatedShell();
    preloadRouteSurface(window.location.pathname);
    setLoading(true);
    setError("");
    try {
      const current = await fetchCurrentUser();
      setMe(current);
      const storedCompanyID = getStoredActiveCompanyID();
      const storedCompanyAllowed = storedCompanyID && (current.is_dev_admin || current.memberships.some((item) => item.company_id === storedCompanyID));
      if (!storedCompanyAllowed) {
        const companyID = current.memberships.find((item) => item.role !== "dev_admin")?.company_id ?? current.memberships[0]?.company_id;
        if (companyID) setActiveCompanyID(companyID);
      }
      const nextPath = nextPathForAuthState(window.location.pathname, true);
      if (nextPath !== window.location.pathname) navigate(nextPath);
    } catch {
      setMe(null);
      if (!isAuthPath(window.location.pathname)) navigate("/login");
    } finally {
      setLoading(false);
    }
  }, [authEnabled, navigate]);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!authEnabled) return;
    if (!hasStoredToken()) {
      const nextPath = nextPathForAuthState(window.location.pathname, false);
      if (nextPath !== window.location.pathname) navigate(nextPath);
      return;
    }
    void loadMe();
  }, [authEnabled, loadMe, navigate]);

  if (!authEnabled) return <React.Suspense fallback={routeFallback}><LazyAppLayout /></React.Suspense>;
  if (loading) return <AuthPanel title="MangoRTS" error={error}><div>Loading</div></AuthPanel>;

  const normalizedPath = path;
  if (!me || isAuthPath(normalizedPath)) {
    if (normalizedPath === "/accept-invite") {
      return <AcceptInvitePage pendingChallenge={pendingChallenge} onChallenge={setPendingChallenge} onAuthenticated={loadMe} onNavigate={navigate} />;
    }
    if (normalizedPath === "/forgot-password") {
      return <ForgotPasswordPage onNavigate={navigate} />;
    }
    if (normalizedPath === "/reset-password") {
      return <ForgotPasswordPage onNavigate={navigate} initialCodeEntryOpen />;
    }
    return <LoginPage onChallenge={setPendingChallenge} onAuthenticated={loadMe} onNavigate={navigate} />;
  }

  if (normalizedPath === "/settings" || normalizedPath === "/admin/users") {
    return <React.Suspense fallback={routeFallback}><LazyAppLayout accountChrome={<AccountBar me={me} onNavigate={navigate} />} me={me} onNavigate={navigate} overrideContent={<SettingsPage me={me} onNavigate={navigate} onLogout={() => logoutAndNavigate(navigate)} embedded />} /></React.Suspense>;
  }

  if (normalizedPath === "/logic-gate-arena") {
    return <React.Suspense fallback={routeFallback}><LazyAppLayout accountChrome={<AccountBar me={me} onNavigate={navigate} />} me={me} onNavigate={navigate} initialPage="logic-gate-arena" /></React.Suspense>;
  }

  if (normalizedPath === "/home" || normalizedPath === "/communications" || normalizedPath === "/communication") {
    return <React.Suspense fallback={routeFallback}><LazyAppLayout accountChrome={<AccountBar me={me} onNavigate={navigate} />} me={me} onNavigate={navigate} initialPage="home" /></React.Suspense>;
  }

  return (
    <>
      <React.Suspense fallback={routeFallback}><LazyAppLayout accountChrome={<AccountBar me={me} onNavigate={navigate} />} me={me} onNavigate={navigate} /></React.Suspense>
    </>
  );
}

function formatLoginError(error: unknown): string {
  return formatAuthError(error, "Login failed");
}

function normalizeEmailInput(email: string): string {
  return email.trim().toLowerCase();
}

function inviteStatusMessage(status?: string): string {
  switch (status) {
    case "sent":
      return "Cognito temporary password email sent.";
    default:
      return "Mango invite created, but Cognito email was not configured.";
  }
}

function formatInviteError(error: unknown): string {
  if (error instanceof Error && error.message.trim() === "This user already exists.") {
    return "This user already exists.";
  }
  return formatAuthError(error, "Invite failed");
}

function invitePasswordError(error: unknown): Error {
  const message = error instanceof Error ? error.message.trim() : "";
  if (message === "Incorrect email or password.") {
    return new Error("The temporary or current password is incorrect for that invited email.");
  }
  return error instanceof Error ? error : new Error("The temporary password check failed.");
}

function companyName(company?: Company | null): string {
  return company?.name?.trim() || "Company";
}

function selectedUserRole(me: CurrentUserResponse, selectedCompany?: CompanyOption | null): string {
  if (me.is_dev_admin) return "dev_admin";
  return selectedCompany?.role || me.memberships[0]?.role || "company_user";
}

function companyOptionKeywords(company: CompanyOption): string {
  return `${company.name} ${company.company_id}`.toLowerCase();
}

function mergeCompanyOptions(...groups: CompanyOption[][]): CompanyOption[] {
  const byID = new Map<string, CompanyOption>();
  for (const group of groups) {
    for (const company of group) {
      const companyID = company.company_id.trim();
      if (!companyID) continue;
      const existing = byID.get(companyID);
      byID.set(companyID, { ...company, role: company.role || existing?.role });
    }
  }
  return Array.from(byID.values()).sort((a, b) => companyName(a).localeCompare(companyName(b)) || a.company_id.localeCompare(b.company_id));
}

function filterCompanyOptions(options: CompanyOption[], query: string): CompanyOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return options.slice(0, COMPANY_SEARCH_LIMIT);
  return options.filter((company) => companyOptionKeywords(company).includes(normalizedQuery)).slice(0, COMPANY_SEARCH_LIMIT);
}

function SettingsCheckIcon({ color = "rgb(71, 85, 105)" }: { color?: string }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block" }}>
      <path d="M3.2 8.2 6.4 11.4 12.9 4.6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsDisclosureIcon({ open, color = "currentColor" }: { open: boolean; color?: string }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", transform: open ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}>
      <path d="M4 6.2 8 10.2 12 6.2" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsSearchIcon({ color = "currentColor" }: { color?: string }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block" }}>
      <circle cx="7" cy="7" r="4.2" fill="none" stroke={color} strokeWidth="1.5" />
      <path d="M10.2 10.2 14 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function useCloseSettingsPopover(open: boolean, ref: React.RefObject<HTMLElement>, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const timer = window.setTimeout(() => window.addEventListener("mousedown", onMouseDown, true), 0);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose, ref]);
}

function SettingsSelect({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: SettingsSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useCloseSettingsPopover(open, rootRef, close);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return (
    <span ref={rootRef} style={{ position: "relative", display: "block", minWidth: 0 }}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((nextOpen) => !nextOpen)}
        style={{ ...settingsSelectButtonStyle, borderColor: open ? "rgba(100, 116, 139, 0.92)" : settingsSelectButtonStyle.borderColor }}
      >
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected?.label ?? "Select"}</span>
        <span aria-hidden="true" style={{ display: "grid", placeItems: "center", color: "rgb(71, 85, 105)" }}>
          <SettingsDisclosureIcon open={open} />
        </span>
      </button>
      {open && (
        <div role="listbox" aria-label={ariaLabel} className="company-explorer-scroll" style={settingsMenuStyle}>
          {options.map((option) => {
            const selectedOption = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selectedOption}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={{ ...settingsOptionButtonStyle, background: selectedOption ? "rgba(100, 116, 139, 0.18)" : "#ffffff", color: "#000000" }}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.label}</span>
                <span aria-hidden="true" style={{ display: "grid", placeItems: "center" }}>
                  {selectedOption ? <SettingsCheckIcon /> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

function CompanySearchSelect({
  value,
  options,
  onChange,
  onSearchQueryChange,
  ariaLabel,
  placeholder = "Search companies",
}: {
  value: string;
  options: CompanyOption[];
  onChange: (companyID: string) => void;
  onSearchQueryChange?: (query: string) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLLabelElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useCloseSettingsPopover(open, rootRef, close);
  const selected = options.find((company) => company.company_id === value) ?? null;
  const matches = useMemo(() => filterCompanyOptions(options, query), [options, query]);

  useEffect(() => {
    if (!open || !onSearchQueryChange) return;
    const timer = window.setTimeout(() => onSearchQueryChange(query), 140);
    return () => window.clearTimeout(timer);
  }, [onSearchQueryChange, open, query]);

  const selectCompany = useCallback((company: CompanyOption) => {
    onChange(company.company_id);
    setQuery("");
    setOpen(false);
  }, [onChange]);

  return (
    <label ref={rootRef} style={{ position: "relative", display: "grid", gap: 5, minWidth: 0 }}>
      <span style={settingsFieldLabelStyle}>{ariaLabel}</span>
      <span style={{ position: "relative", display: "block", minWidth: 0 }}>
        <input
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) {
              event.preventDefault();
              selectCompany(matches[0]);
            }
            if (event.key === "ArrowDown") setOpen(true);
          }}
          placeholder={selected ? companyName(selected) : placeholder}
          autoComplete="off"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          style={{ ...settingsInputStyle, paddingRight: 58 }}
        />
        <span aria-hidden="true" style={{ position: "absolute", right: 31, top: 11, color: "rgba(100, 116, 139, 0.84)", pointerEvents: "none" }}>
          <SettingsSearchIcon />
        </span>
        <button
          type="button"
          aria-label={`${ariaLabel} list`}
          onClick={() => setOpen((nextOpen) => !nextOpen)}
          style={settingsComboIconButtonStyle}
        >
          <SettingsDisclosureIcon open={open} />
        </button>
      </span>
      {open && (
        <div role="listbox" aria-label={ariaLabel} className="company-explorer-scroll" style={{ ...settingsMenuStyle, maxHeight: 310 }}>
          {matches.length === 0 ? (
            <div style={settingsEmptyOptionStyle}>No companies found</div>
          ) : matches.map((company) => {
            const selectedOption = company.company_id === value;
            return (
              <button
                key={company.company_id}
                type="button"
                role="option"
                aria-selected={selectedOption}
                title={company.company_id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectCompany(company)}
                style={{ ...settingsCompanyOptionButtonStyle, background: selectedOption ? "rgba(100, 116, 139, 0.18)" : "transparent" }}
              >
                <span style={{ minWidth: 0, display: "grid", gap: 2 }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#000000", fontWeight: 600 }}>{companyName(company)}</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#000000", fontSize: 10 }}>{company.company_id}</span>
                </span>
                <span aria-hidden="true" style={{ display: "grid", placeItems: "center" }}>
                  {selectedOption ? <SettingsCheckIcon /> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </label>
  );
}

function LoginPage({ onChallenge, onAuthenticated, onNavigate }: { onChallenge: (challenge: PendingChallenge) => void; onAuthenticated: () => Promise<void>; onNavigate: (path: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <AuthPanel title="MangoRTS" error={error}>
      <form style={{ display: "grid", gap: 10 }} onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          const result = await loginWithPassword(email, password);
          if (result.status === "new_password_required") {
            onChallenge(result);
            onNavigate("/accept-invite");
            return;
          }
          await onAuthenticated();
        } catch (loginError) {
          console.error("Login failed", loginError);
          setError(formatLoginError(loginError));
        } finally {
          setBusy(false);
        }
      }}>
        <input style={inputStyle} value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="Email" autoComplete="email" />
        <input style={inputStyle} value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Password" autoComplete="current-password" />
        <button style={buttonStyle} disabled={busy}>{busy ? "Signing in" : "Sign in"}</button>
      </form>
      <div style={{ display: "flex", gap: 10, justifyContent: "space-between", fontSize: 12 }}>
        <button style={linkButtonStyle} onClick={() => onNavigate("/accept-invite")}>Accept invite</button>
        <button style={linkButtonStyle} onClick={() => onNavigate("/forgot-password")}>Forgot password</button>
      </div>
    </AuthPanel>
  );
}

function AcceptInvitePage({ pendingChallenge, onChallenge, onAuthenticated, onNavigate }: { pendingChallenge: PendingChallenge; onChallenge: (challenge: PendingChallenge) => void; onAuthenticated: () => Promise<void>; onNavigate: (path: string) => void }) {
  const params = new URLSearchParams(window.location.search);
  const [token, setToken] = useState(params.get("token") ?? "");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState(pendingChallenge?.username ?? "");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordStepComplete, setPasswordStepComplete] = useState(() => hasStoredToken());
  const showPasswordStep = !passwordStepComplete && !hasStoredToken();
  return (
    <AuthPanel title="Accept Invite" error={error}>
      <form style={{ display: "grid", gap: 10 }} onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          if (!token.trim()) {
            throw new Error("Enter the Mango invite token.");
          }
          if (!displayName.trim()) {
            throw new Error("Enter your name.");
          }
          const invitation = await validateInvitationToken(token);
          const invitedEmail = normalizeEmailInput(invitation.email);
          if (hasStoredToken()) {
            onChallenge(null);
            setPasswordStepComplete(true);
          } else {
            if (pendingChallenge) {
              if (invitedEmail && normalizeEmailInput(pendingChallenge.username) !== invitedEmail) {
                throw new Error("This Mango invite token belongs to a different email address.");
              }
              if (!newPassword.trim()) {
                throw new Error("Enter a new password.");
              }
              await completeNewPassword(pendingChallenge.username, pendingChallenge.session, newPassword);
            } else {
              if (!email.trim()) {
                throw new Error("Enter the invited email address.");
              }
              if (!temporaryPassword.trim()) {
                throw new Error("Enter the Cognito temporary password from the invite email, or your current password if you already changed it.");
              }
              if (invitedEmail && normalizeEmailInput(email) !== invitedEmail) {
                throw new Error("This Mango invite token belongs to a different email address.");
              }
              let result: LoginResult;
              try {
                result = await loginWithPassword(email, temporaryPassword);
              } catch (passwordError) {
                throw invitePasswordError(passwordError);
              }
              if (result.status === "new_password_required") {
                if (!newPassword.trim()) {
                  throw new Error("Enter a new password.");
                }
                await completeNewPassword(result.username, result.session, newPassword);
              }
            }
            onChallenge(null);
            setPasswordStepComplete(true);
          }
          await acceptInvitation(token, displayName);
          await onAuthenticated();
          onNavigate("/home");
        } catch (inviteError) {
          console.error("Invite acceptance failed", inviteError);
          setError(formatAuthError(inviteError, "Invite acceptance failed"));
        } finally {
          setBusy(false);
        }
      }}>
        <input style={inputStyle} value={token} onChange={(event) => setToken(event.target.value)} placeholder="Invite token" autoComplete="off" />
        <input style={inputStyle} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" autoComplete="name" />
        {showPasswordStep && !pendingChallenge && <input style={inputStyle} value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="Email" autoComplete="email" />}
        {showPasswordStep && !pendingChallenge && <input style={inputStyle} value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} type="password" placeholder="Temporary or current password" autoComplete="current-password" />}
        {showPasswordStep && <input style={inputStyle} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" placeholder="New password" autoComplete="new-password" />}
        <button style={buttonStyle} disabled={busy}>{busy ? "Accepting" : "Accept invite"}</button>
      </form>
      <button style={linkButtonStyle} onClick={() => onNavigate("/login")}>Back to login</button>
    </AuthPanel>
  );
}

function ForgotPasswordPage({ onNavigate, initialCodeEntryOpen = false }: { onNavigate: (path: string) => void; initialCodeEntryOpen?: boolean }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [codeEntryOpen, setCodeEntryOpen] = useState(initialCodeEntryOpen);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthPanel title="Forgot Password" error={error}>
      <form style={{ display: "grid", gap: 10 }} onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        setSuccess("");
        setBusy(true);
        try {
          const payload = await forgotPassword(email);
          const seconds = payload.expires_in_seconds || PASSWORD_RESET_SECONDS;
          setExpiresAt(Date.now() + seconds * 1000);
          setCodeEntryOpen(true);
          setMessage("Reset code sent. It expires in about 1 hour.");
        } catch (resetRequestError) {
          setError(formatAuthError(resetRequestError, "Password reset request failed"));
        } finally {
          setBusy(false);
        }
      }}>
        <input style={inputStyle} value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="Email" autoComplete="email" />
        <button style={buttonStyle} disabled={busy}>{busy ? "Sending" : "Send reset code"}</button>
      </form>
      {message && <div style={{ fontSize: 12 }}>{message}</div>}
      {codeEntryOpen && (
        <form style={{ display: "grid", gap: 10 }} onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          setSuccess("");
          if (expiresAt !== null && Date.now() > expiresAt) {
            setError("The reset code has expired. Request a new reset code.");
            return;
          }
          setBusy(true);
          try {
            await resetPassword(email, code, password);
            setSuccess("Password has been reset.");
            setCode("");
            setPassword("");
          } catch (resetError) {
            setError(formatAuthError(resetError, "Password reset failed"));
          } finally {
            setBusy(false);
          }
        }}>
          <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 600 }}>
            Enter reset code in here
            <input style={inputStyle} value={code} onChange={(event) => setCode(event.target.value)} placeholder="Reset code" autoComplete="one-time-code" />
          </label>
          <input style={inputStyle} value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="New password" autoComplete="new-password" />
          <button style={buttonStyle} disabled={busy}>{busy ? "Submitting" : "Submit"}</button>
        </form>
      )}
      {success && <div style={successMessageStyle}>{success}</div>}
      <button style={linkButtonStyle} onClick={() => onNavigate("/login")}>Back to login</button>
    </AuthPanel>
  );
}

function SettingsPage({ me, onNavigate, onLogout, embedded = false }: { me: CurrentUserResponse; onNavigate: (path: string) => void; onLogout: () => void; embedded?: boolean }) {
  const membershipOptions = useMemo<CompanyOption[]>(
    () => me.memberships.map((item) => ({ company_id: item.company_id, name: item.company_name || "Company", role: item.role })),
    [me],
  );
  const [devCompanies, setDevCompanies] = useState<CompanyOption[]>([]);
  const [createdCompanies, setCreatedCompanies] = useState<Company[]>([]);
  const createdCompanyOptions = useMemo<CompanyOption[]>(() => createdCompanies.map((company) => ({ ...company })), [createdCompanies]);
  const companyOptions = useMemo<CompanyOption[]>(
    () => mergeCompanyOptions(createdCompanyOptions, devCompanies, membershipOptions),
    [createdCompanyOptions, devCompanies, membershipOptions],
  );
  const [companyID, setCompanyID] = useState(() => {
    const activeCompanyID = getActiveCompanyID();
    if (membershipOptions.some((company) => company.company_id === activeCompanyID)) return activeCompanyID;
    return membershipOptions.find((company) => company.role !== "dev_admin")?.company_id ?? membershipOptions[0]?.company_id ?? activeCompanyID;
  });
  const selectedCompany = companyOptions.find((company) => company.company_id === companyID) ?? null;
  const canManageSelectedCompany = Boolean(companyID) && (me.is_dev_admin || selectedCompany?.role === "company_admin");
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [inviteCompanyID, setInviteCompanyID] = useState(() => companyID);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("company_user");
  const [inviteToken, setInviteToken] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [createdCompanyNotice, setCreatedCompanyNotice] = useState<Company | null>(null);
  const [companyBusy, setCompanyBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newSettingsPassword, setNewSettingsPassword] = useState("");
  const [confirmSettingsPassword, setConfirmSettingsPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<CompanyUser | null>(null);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState("");
  const inviteSelectedCompany = companyOptions.find((company) => company.company_id === inviteCompanyID) ?? null;
  const activeCompanyLabel = selectedCompany ? companyName(selectedCompany) : companyID ? "Selected company" : "No company selected";
  const canInvite = me.is_dev_admin || canManageSelectedCompany;
  const [userGroups, setUserGroups] = useState<CompanyUserGroup[]>([]);
  const [userGroupMembers, setUserGroupMembers] = useState<CompanyUserGroupMember[]>([]);
  const [selectedUserGroupID, setSelectedUserGroupID] = useState("");
  const [newUserGroupName, setNewUserGroupName] = useState("");
  const [newChildUserGroupName, setNewChildUserGroupName] = useState("");
  const [groupMemberDraft, setGroupMemberDraft] = useState<Set<string>>(new Set());
  const [groupBusy, setGroupBusy] = useState(false);
  const selectedUserGroup = userGroups.find((group) => group.group_id === selectedUserGroupID) ?? null;
  const userGroupChildrenByParent = useMemo(() => {
    const grouped = new Map<string, CompanyUserGroup[]>();
    for (const group of userGroups) {
      const parentID = group.parent_group_id?.trim() ?? "";
      const list = grouped.get(parentID) ?? [];
      list.push(group);
      grouped.set(parentID, list);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name) || a.group_id.localeCompare(b.group_id));
    }
    return grouped;
  }, [userGroups]);

  const loadCompanyOptions = useCallback(async (query = "") => {
    if (!me.is_dev_admin) return;
    const params = new URLSearchParams();
    const trimmedQuery = query.trim();
    if (trimmedQuery) params.set("query", trimmedQuery);
    params.set("limit", String(COMPANY_SEARCH_LIMIT));
    try {
      const payload = await apiFetchJSON<{ companies: Company[] }>(`/v1/companies?${params.toString()}`);
      const nextCompanies = (payload.companies ?? []).map((company) => ({ ...company }));
      setDevCompanies((previous) => mergeCompanyOptions(nextCompanies, previous));
    } catch (companyLookupError) {
      console.error("Company lookup failed", companyLookupError);
      setError("Failed to load company list");
    }
  }, [me.is_dev_admin]);

  const load = useCallback(async () => {
    if (!companyID || !canManageSelectedCompany) {
      setUsers([]);
      setUserGroups([]);
      setUserGroupMembers([]);
      setSelectedUserGroupID("");
      return;
    }
    setError("");
    try {
      const [usersPayload, groupsPayload] = await Promise.all([
        apiFetchJSON<{ users: CompanyUser[] }>(`/v1/companies/${encodeURIComponent(companyID)}/users`),
        apiFetchJSON<{ groups: CompanyUserGroup[]; members: CompanyUserGroupMember[] }>(`/v1/companies/${encodeURIComponent(companyID)}/user-groups`),
      ]);
      setUsers(usersPayload.users ?? []);
      setUserGroups(groupsPayload.groups ?? []);
      setUserGroupMembers(groupsPayload.members ?? []);
      setSelectedUserGroupID((previous) => (groupsPayload.groups ?? []).some((group) => group.group_id === previous) ? previous : (groupsPayload.groups ?? [])[0]?.group_id ?? "");
    } catch {
      setError("Failed to load users");
    }
  }, [canManageSelectedCompany, companyID]);

  useEffect(() => { void loadCompanyOptions(""); }, [loadCompanyOptions]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (companyID) setActiveCompanyID(companyID); }, [companyID]);
  useEffect(() => {
    const memberIDs = userGroupMembers.filter((member) => member.group_id === selectedUserGroupID).map((member) => member.user_id);
    setGroupMemberDraft(new Set(memberIDs));
  }, [selectedUserGroupID, userGroupMembers]);
  useEffect(() => {
    if (!me.is_dev_admin) setInviteCompanyID(companyID);
    else if (!inviteCompanyID && companyID) setInviteCompanyID(companyID);
  }, [companyID, inviteCompanyID, me.is_dev_admin]);

  const createUserGroup = async (parentGroupID = "") => {
    const name = (parentGroupID ? newChildUserGroupName : newUserGroupName).trim();
    if (!companyID || !name) {
      setError("Group name required");
      return;
    }
    setGroupBusy(true);
    setError("");
    try {
      const group = await apiFetchJSON<CompanyUserGroup>(`/v1/companies/${encodeURIComponent(companyID)}/user-groups`, {
        method: "POST",
        body: JSON.stringify({ name, parent_group_id: parentGroupID }),
      });
      setUserGroups((previous) => [...previous.filter((item) => item.group_id !== group.group_id), group]);
      setSelectedUserGroupID(group.group_id);
      if (parentGroupID) setNewChildUserGroupName("");
      else setNewUserGroupName("");
      await load();
    } catch (groupError) {
      console.error("Create user group failed", groupError);
      setError(formatAuthError(groupError, "Create group failed"));
    } finally {
      setGroupBusy(false);
    }
  };

  const saveSelectedUserGroupMembers = async () => {
    if (!companyID || !selectedUserGroupID) return;
    setGroupBusy(true);
    setError("");
    try {
      const payload = await apiFetchJSON<{ members: CompanyUserGroupMember[] }>(`/v1/companies/${encodeURIComponent(companyID)}/user-groups/${encodeURIComponent(selectedUserGroupID)}/members`, {
        method: "PUT",
        body: JSON.stringify({ company_id: companyID, user_ids: Array.from(groupMemberDraft) }),
      });
      setUserGroupMembers((previous) => [
        ...previous.filter((member) => member.group_id !== selectedUserGroupID),
        ...(payload.members ?? []),
      ]);
      await load();
    } catch (groupError) {
      console.error("Save user group members failed", groupError);
      setError(formatAuthError(groupError, "Save group users failed"));
    } finally {
      setGroupBusy(false);
    }
  };

  const deleteSelectedUserGroup = async () => {
    if (!companyID || !selectedUserGroupID) return;
    setGroupBusy(true);
    setError("");
    try {
      await apiFetchJSON(`/v1/companies/${encodeURIComponent(companyID)}/user-groups/${encodeURIComponent(selectedUserGroupID)}`, { method: "DELETE" });
      setSelectedUserGroupID("");
      await load();
    } catch (groupError) {
      console.error("Delete user group failed", groupError);
      setError(formatAuthError(groupError, "Delete group failed"));
    } finally {
      setGroupBusy(false);
    }
  };

  const renderUserGroup = (group: CompanyUserGroup, depth = 0): React.ReactNode => {
    const childGroups = userGroupChildrenByParent.get(group.group_id) ?? [];
    const memberCount = userGroupMembers.filter((member) => member.group_id === group.group_id).length;
    return (
      <div key={group.group_id} style={{ display: "grid", gap: 4, marginLeft: depth * 14 }}>
        <button
          type="button"
          style={{
            ...smallButtonStyle,
            justifyContent: "space-between",
            display: "flex",
            minHeight: 30,
            borderColor: selectedUserGroupID === group.group_id ? "rgba(100,116,139,0.84)" : "rgba(0,0,0,0.16)",
          }}
          onClick={() => setSelectedUserGroupID(group.group_id)}
        >
          <span style={{ overflowWrap: "anywhere", textAlign: "left" }}>{group.name}</span>
          <span style={{ color: "#5f6368" }}>{memberCount}</span>
        </button>
        {childGroups.map((child) => renderUserGroup(child, depth + 1))}
      </div>
    );
  };

  return (
    <div style={embedded ? { ...settingsPageStyle, minHeight: "100%", boxSizing: "border-box" } : settingsPageStyle}>
      <div style={settingsHeaderStyle}>
        <h1 style={settingsPageTitleStyle}>Settings</h1>
        {!embedded && <div style={settingsNavStyle}>
          <button style={smallButtonStyle} onClick={() => onNavigate("/")}>MangoRTS</button>
          <button style={smallButtonStyle} onClick={() => onNavigate("/logic-gate-arena")} {...logicGateArenaPrefetch}>Logic Gate Arena</button>
          <button style={smallButtonStyle} onClick={() => onNavigate("/home")} {...homePrefetch}>Home</button>
        </div>}
      </div>
      {error && <div style={settingsErrorStyle}>{error}</div>}
      <div style={settingsTopRowStyle}>
        <section style={{ ...sectionStyle, flex: "1 1 280px" }}>
          <h2 style={sectionTitleStyle}>Company</h2>
          <div style={settingsScopePlateStyle}>
            <span style={settingsScopeKickerStyle}>Active Scope</span>
            <span style={settingsScopeNameStyle}>{activeCompanyLabel}</span>
            {companyID && <span style={settingsScopeUUIDStyle}>UUID: {companyID}</span>}
          </div>
          <CompanySearchSelect
            value={companyID}
            options={companyOptions}
            onChange={setCompanyID}
            onSearchQueryChange={me.is_dev_admin ? loadCompanyOptions : undefined}
            ariaLabel="Company Scope"
            placeholder="Search company or UUID"
          />
          {companyID && (
            <div style={settingsActiveScopeStyle}>
              Scope active: {activeCompanyLabel}
              <span style={{ overflowWrap: "anywhere" }}> {companyID}</span>
            </div>
          )}
          {me.is_dev_admin && (
            <div style={settingsSubsectionStyle}>
              <h3 style={settingsSubsectionTitleStyle}>Create New Company</h3>
              <form style={{ display: "grid", gap: 8 }} onSubmit={async (event) => {
                event.preventDefault();
                setError("");
                setCreatedCompanyNotice(null);
                if (!newCompanyName.trim()) {
                  setError("Company name required");
                  return;
                }
                setCompanyBusy(true);
                try {
                  const company = await apiFetchJSON<Company>("/v1/companies", { method: "POST", body: JSON.stringify({ name: newCompanyName }) });
                  setCreatedCompanies((prev) => [company, ...prev.filter((item) => item.company_id !== company.company_id)]);
                  setCompanyID(company.company_id);
                  setInviteCompanyID(company.company_id);
                  setCreatedCompanyNotice(company);
                  setNewCompanyName("");
                } catch (companyError) {
                  console.error("Company creation failed", companyError);
                  setError(formatAuthError(companyError, "Company creation failed"));
                } finally {
                  setCompanyBusy(false);
                }
              }}>
                <input style={settingsInputStyle} value={newCompanyName} onChange={(event) => setNewCompanyName(event.target.value)} placeholder="New company name" />
                <button style={settingsPrimaryButtonStyle} disabled={companyBusy}>{companyBusy ? "Creating" : "Create new company"}</button>
              </form>
              {createdCompanyNotice && (
                <div style={successBoxStyle}>
                  <span>Company created: {createdCompanyNotice.name}</span>
                  <span style={{ overflowWrap: "anywhere" }}>UUID: {createdCompanyNotice.company_id}</span>
                </div>
              )}
            </div>
          )}
        </section>
        {canInvite && <section style={{ ...sectionStyle, flex: "1 1 280px" }}>
          <h2 style={sectionTitleStyle}>Invite</h2>
          <form style={{ display: "grid", gap: 8 }} onSubmit={async (event) => {
            event.preventDefault();
            const normalizedInviteEmail = normalizeEmailInput(inviteEmail);
            const targetCompanyID = me.is_dev_admin ? inviteCompanyID : companyID;
            setError("");
            setInviteMessage("");
            setInviteToken("");
            if (!targetCompanyID) {
              setError("Invite company required");
              return;
            }
            if (!normalizedInviteEmail) {
              setError("Email required");
              return;
            }
            try {
              const payload = await apiFetchJSON<{ invitation: { token?: string }; cognito_invite_status?: string }>("/v1/invitations", {
                method: "POST",
                body: JSON.stringify({ company_id: targetCompanyID, email: normalizedInviteEmail, role: inviteRole }),
              });
              setInviteToken(payload.invitation.token ?? "");
              setInviteMessage(inviteStatusMessage(payload.cognito_invite_status));
              setInviteEmail("");
              await load();
            } catch (inviteError) {
              console.error("Invite failed", inviteError);
              setError(formatInviteError(inviteError));
            }
          }}>
            {me.is_dev_admin && (
              <CompanySearchSelect
                value={inviteCompanyID}
                options={companyOptions}
                onChange={setInviteCompanyID}
                onSearchQueryChange={loadCompanyOptions}
                ariaLabel="Invite Company"
                placeholder="Search company or UUID"
              />
            )}
            {me.is_dev_admin && inviteCompanyID && (
              <div style={settingsActiveScopeStyle}>
                Invite target: {inviteSelectedCompany ? companyName(inviteSelectedCompany) : "Selected company"}
                <span style={{ overflowWrap: "anywhere" }}> {inviteCompanyID}</span>
              </div>
            )}
            <input style={settingsInputStyle} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value.toLowerCase())} type="email" placeholder="Email" />
            <SettingsSelect value={inviteRole} options={INVITE_ROLE_OPTIONS} onChange={setInviteRole} ariaLabel="User role" />
            <button style={settingsPrimaryButtonStyle}>Invite user</button>
          </form>
          {inviteToken && <div style={settingsTokenStyle}>Invite token: {inviteToken}</div>}
          {inviteMessage && <div style={settingsInfoTextStyle}>{inviteMessage}</div>}
        </section>}
        <section style={{ ...sectionStyle, flex: me.is_dev_admin ? "0 1 360px" : "1 1 280px", marginLeft: me.is_dev_admin ? "auto" : undefined }}>
          <div style={settingsProfileHeaderStyle}>
            <h2 style={sectionTitleStyle}>User Profile</h2>
            <button style={smallButtonStyle} onClick={onLogout}>Logout</button>
          </div>
          <div style={profileGridStyle}>
            <span style={profileLabelStyle}>Name</span>
            <span style={profileValueStyle}>{me.user.display_name || "No name set"}</span>
            <span style={profileLabelStyle}>Email</span>
            <span style={profileValueStyle}>{me.user.email}</span>
            <span style={profileLabelStyle}>Role</span>
            <span style={profileValueStyle}>{selectedUserRole(me, selectedCompany)}</span>
          </div>
          <form style={settingsSubsectionStyle} onSubmit={async (event) => {
            event.preventDefault();
            setPasswordError("");
            setPasswordMessage("");
            if (!currentPassword || !newSettingsPassword) {
              setPasswordError("Enter your current password and a new password.");
              return;
            }
            if (newSettingsPassword !== confirmSettingsPassword) {
              setPasswordError("New password and confirmation do not match.");
              return;
            }
            setPasswordBusy(true);
            try {
              await changePassword(currentPassword, newSettingsPassword);
              setPasswordMessage("Password changed.");
              setCurrentPassword("");
              setNewSettingsPassword("");
              setConfirmSettingsPassword("");
            } catch (changeError) {
              console.error("Password change failed", changeError);
              setPasswordError(formatAuthError(changeError, "Password change failed"));
            } finally {
              setPasswordBusy(false);
            }
          }}>
            <h3 style={settingsSubsectionTitleStyle}>Change Password</h3>
            <input style={settingsInputStyle} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type="password" placeholder="Current password" autoComplete="current-password" />
            <input style={settingsInputStyle} value={newSettingsPassword} onChange={(event) => setNewSettingsPassword(event.target.value)} type="password" placeholder="New password" autoComplete="new-password" />
            <input style={settingsInputStyle} value={confirmSettingsPassword} onChange={(event) => setConfirmSettingsPassword(event.target.value)} type="password" placeholder="Confirm new password" autoComplete="new-password" />
            <button style={settingsPrimaryButtonStyle} disabled={passwordBusy}>{passwordBusy ? "Changing" : "Change password"}</button>
          </form>
          {passwordError && <div style={settingsErrorSmallStyle}>{passwordError}</div>}
          {passwordMessage && <div style={successMessageStyle}>{passwordMessage}</div>}
        </section>
      </div>
      {canManageSelectedCompany && <section style={{ ...sectionStyle, marginTop: 14 }}>
        <div style={settingsSectionHeaderRowStyle}>
          <h2 style={sectionTitleStyle}>Company Users</h2>
          <span style={settingsSectionScopeStyle}>
            {activeCompanyLabel}
            {companyID && <span style={{ overflowWrap: "anywhere" }}> {companyID}</span>}
          </span>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {users.length === 0 && <div style={settingsInfoTextStyle}>No users in this company scope.</div>}
          {users.map((user) => (
            <div key={user.user_id} style={userRowStyle}>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{companyUserLabel(user)}</span>
              <span>{user.role}</span>
              <button
                type="button"
                style={{ ...smallButtonStyle, ...dangerButtonStyle }}
                disabled={user.user_id === me.user.user_id}
                onClick={() => {
                  setError("");
                  setDeleteAcknowledged(false);
                  setDeleteConfirmation(user);
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </section>}
      {canManageSelectedCompany && <section style={{ ...sectionStyle, marginTop: 14 }}>
        <div style={settingsSectionHeaderRowStyle}>
          <h2 style={sectionTitleStyle}>User Groups</h2>
          <span style={settingsSectionScopeStyle}>{activeCompanyLabel}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: 14 }}>
          <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
            <form style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8 }} onSubmit={(event) => {
              event.preventDefault();
              void createUserGroup("");
            }}>
              <input style={settingsInputStyle} value={newUserGroupName} onChange={(event) => setNewUserGroupName(event.target.value)} placeholder="New group name" />
              <button type="submit" style={smallButtonStyle} disabled={groupBusy}>Create</button>
            </form>
            <div style={{ display: "grid", gap: 4 }}>
              {userGroups.length === 0 && <div style={settingsInfoTextStyle}>No groups yet.</div>}
              {(userGroupChildrenByParent.get("") ?? []).map((group) => renderUserGroup(group))}
            </div>
          </div>
          <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
            {selectedUserGroup ? (
              <>
                <div style={settingsSubsectionTitleStyle}>{selectedUserGroup.name}</div>
                <form style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8 }} onSubmit={(event) => {
                  event.preventDefault();
                  void createUserGroup(selectedUserGroup.group_id);
                }}>
                  <input style={settingsInputStyle} value={newChildUserGroupName} onChange={(event) => setNewChildUserGroupName(event.target.value)} placeholder="Child group name" />
                  <button type="submit" style={smallButtonStyle} disabled={groupBusy}>Create child</button>
                </form>
                <div style={{ display: "grid", gap: 4, maxHeight: 260, overflow: "auto", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 6, padding: 8 }}>
                  {users.map((user) => (
                    <label key={user.user_id} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", gap: 8, alignItems: "center", fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={groupMemberDraft.has(user.user_id)}
                        onChange={(event) => {
                          setGroupMemberDraft((previous) => {
                            const next = new Set(previous);
                            if (event.target.checked) next.add(user.user_id);
                            else next.delete(user.user_id);
                            return next;
                          });
                        }}
                      />
                      <span style={{ overflowWrap: "anywhere" }}>{companyUserLabel(user)}</span>
                      <span style={{ color: "#5f6368" }}>{user.role}</span>
                    </label>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button type="button" style={{ ...smallButtonStyle, ...dangerButtonStyle }} disabled={groupBusy} onClick={() => void deleteSelectedUserGroup()}>Delete group</button>
                  <button type="button" style={settingsPrimaryButtonStyle} disabled={groupBusy} onClick={() => void saveSelectedUserGroupMembers()}>{groupBusy ? "Saving" : "Save users"}</button>
                </div>
              </>
            ) : (
              <div style={settingsInfoTextStyle}>Select a group to manage users.</div>
            )}
          </div>
        </div>
      </section>}
      {deleteConfirmation && (
        <div style={modalBackdropStyle}>
          <div style={modalStyle}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#000000" }}>
              Are you sure you want to delete this user?
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.4, color: "#000000", overflowWrap: "anywhere" }}>
              This deletes {companyUserLabel(deleteConfirmation)} from Cognito and removes their Mango user, memberships, and invitation rows.
            </div>
            <label style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 8, alignItems: "start", fontSize: 11, lineHeight: 1.35 }}>
              <input type="checkbox" checked={deleteAcknowledged} onChange={(event) => setDeleteAcknowledged(event.target.checked)} />
              <span>Yes I know what I'm doing I want to delete this user.</span>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                type="button"
                disabled={!deleteAcknowledged || deleteBusy}
                onClick={async () => {
                  if (!companyID || !deleteConfirmation) return;
                  setDeleteBusy(true);
                  setError("");
                  try {
                    await apiFetchJSON(`/v1/companies/${encodeURIComponent(companyID)}/users/${encodeURIComponent(deleteConfirmation.user_id)}`, { method: "DELETE" });
                    setUsers((previous) => previous.filter((user) => user.user_id !== deleteConfirmation.user_id));
                    setDeleteConfirmation(null);
                    setDeleteAcknowledged(false);
                    await load();
                  } catch (deleteError) {
                    console.error("Delete user failed", deleteError);
                    setError(formatAuthError(deleteError, "Delete user failed"));
                  } finally {
                    setDeleteBusy(false);
                  }
                }}
                style={{ ...smallButtonStyle, minHeight: 34, fontWeight: 600 }}
              >
                {deleteBusy ? "Deleting" : "Yes"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmation(null);
                  setDeleteAcknowledged(false);
                }}
                style={{ ...smallButtonStyle, minHeight: 34, ...dangerButtonStyle }}
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AuthPanel({ title, error, children }: { title: string; error?: string; children: React.ReactNode }) {
  return (
    <div style={panelStyle}>
      <div style={formStyle}>
        <h1 style={{ margin: 0, lineHeight: 1 }}>{title === "MangoRTS" ? <MangoWordmark size={28} weight={500} /> : title}</h1>
        {error && <div style={{ color: "#b00020", fontSize: 12 }}>{error}</div>}
        {children}
      </div>
    </div>
  );
}

function AccountBar({ me, onNavigate }: { me: CurrentUserResponse; onNavigate: (path: string) => void }) {
  const displayName = me.user.display_name?.trim() || me.user.email;
  const navButtonStyle: React.CSSProperties = {
    width: 30,
    height: 30,
    display: "grid",
    placeItems: "center",
    border: "1px solid rgba(100, 116, 139, 0.22)",
    borderRadius: 6,
    background: "#ffffff",
    color: "#60646c",
    cursor: "pointer",
    font: "inherit",
    fontWeight: 500,
    padding: 0,
  };
  return (
    <button
      type="button"
      aria-label={`Settings for ${displayName}`}
      title="Settings"
      style={navButtonStyle}
      onClick={() => onNavigate("/settings")}
    >
      <HeaderSettingsIcon />
    </button>
  );
}

function logoutAndNavigate(navigate: (path: string) => void): void {
  logout();
  navigate("/login");
}

const linkButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#334155",
  cursor: "pointer",
  font: "inherit",
  padding: 0,
};

const smallButtonStyle: React.CSSProperties = {
  minHeight: 30,
  border: "1px solid rgba(100, 116, 139, 0.62)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#000000",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 600,
  padding: "0 10px",
  boxShadow: "0 0 0 1px rgba(100, 116, 139, 0.12) inset",
};

const settingsPageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#ffffff",
  color: "#000000",
  fontFamily: "var(--mango-font-family)",
  padding: 18,
  overflowY: "auto",
};

const settingsHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 16,
};

const settingsPageTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  color: "#000000",
  fontWeight: 500,
};

const settingsNavStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  gap: 8,
};

const settingsErrorStyle: React.CSSProperties = {
  color: "#b00020",
  marginBottom: 10,
  fontSize: 12,
  fontWeight: 600,
};

const settingsErrorSmallStyle: React.CSSProperties = {
  color: "#b00020",
  fontSize: 12,
};

const settingsInfoTextStyle: React.CSSProperties = {
  color: "#000000",
  fontSize: 12,
  lineHeight: 1.4,
};

const settingsFieldLabelStyle: React.CSSProperties = {
  color: "#000000",
  fontSize: 10,
  fontWeight: 500,
};

const settingsInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 38,
  border: "1px solid rgba(100, 116, 139, 0.44)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#000000",
  font: "inherit",
  fontSize: 12,
  fontWeight: 500,
  padding: "0 10px",
  outline: "none",
  boxShadow: "0 0 0 1px rgba(100, 116, 139, 0.08) inset",
};

const settingsPrimaryButtonStyle: React.CSSProperties = {
  minHeight: 38,
  border: "1px solid rgba(100, 116, 139, 0.84)",
  borderRadius: 6,
  background: "var(--mango-gradient)",
  color: "#000000",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 600,
  padding: "0 12px",
  boxShadow: "0 0 18px rgba(100, 116, 139, 0.22)",
};

const settingsSelectButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 38,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 18px",
  alignItems: "center",
  gap: 8,
  border: "1px solid rgba(100, 116, 139, 0.44)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#000000",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 500,
  padding: "0 10px",
  textAlign: "left",
};

const settingsComboIconButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 5,
  right: 5,
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(100, 116, 139, 0.36)",
  borderRadius: 5,
  background: "#ffffff",
  color: "#000000",
  cursor: "pointer",
};

const settingsMenuStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 40,
  top: "calc(100% + 6px)",
  left: 0,
  width: "min(460px, 92vw)",
  maxHeight: 260,
  overflowY: "auto",
  overflowX: "hidden",
  padding: 5,
  border: "1px solid rgba(100, 116, 139, 0.58)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#000000",
  boxShadow: "0 12px 28px rgba(0, 0, 0, 0.14), 0 0 0 1px rgba(100, 116, 139, 0.12) inset",
};

const settingsOptionButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 32,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 18px",
  alignItems: "center",
  gap: 8,
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 500,
  padding: "7px 8px",
  textAlign: "left",
};

const settingsCompanyOptionButtonStyle: React.CSSProperties = {
  ...settingsOptionButtonStyle,
  minHeight: 42,
};

const settingsEmptyOptionStyle: React.CSSProperties = {
  padding: "8px 10px",
  color: "#000000",
  fontSize: 11,
  fontWeight: 500,
};

const settingsScopePlateStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  border: "1px solid rgba(100, 116, 139, 0.32)",
  borderRadius: 8,
  background: "#ffffff",
  padding: 10,
};

const settingsScopeKickerStyle: React.CSSProperties = {
  color: "#000000",
  fontSize: 10,
  fontWeight: 500,
};

const settingsScopeNameStyle: React.CSSProperties = {
  minWidth: 0,
  color: "#000000",
  fontSize: 15,
  fontWeight: 600,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const settingsScopeUUIDStyle: React.CSSProperties = {
  color: "#000000",
  fontSize: 11,
  overflowWrap: "anywhere",
};

const settingsActiveScopeStyle: React.CSSProperties = {
  border: "1px solid rgba(100, 116, 139, 0.34)",
  borderRadius: 6,
  background: "#f8fafc",
  color: "#000000",
  fontSize: 11,
  fontWeight: 600,
  padding: "7px 8px",
};

const settingsSubsectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  borderTop: "1px solid rgba(100, 116, 139, 0.18)",
  paddingTop: 10,
};

const settingsSubsectionTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#000000",
  fontSize: 11,
  fontWeight: 600,
};

const settingsTokenStyle: React.CSSProperties = {
  ...settingsInfoTextStyle,
  overflowWrap: "anywhere",
};

const settingsSectionHeaderRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  flexWrap: "wrap",
  gap: 8,
};

const settingsSectionScopeStyle: React.CSSProperties = {
  minWidth: 0,
  color: "#000000",
  fontSize: 11,
  fontWeight: 500,
};

const sectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
  padding: 14,
  border: "1px solid rgba(100, 116, 139, 0.68)",
  background: "#ffffff",
  borderRadius: 8,
  color: "#000000",
  boxShadow: "0 0 0 1px rgba(100, 116, 139, 0.12) inset, 0 12px 24px rgba(0, 0, 0, 0.12)",
};

const settingsTopRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 14,
  alignItems: "stretch",
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: "#000000",
  letterSpacing: 0,
  fontWeight: 600,
};

const settingsProfileHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

const successMessageStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "#166534",
  fontSize: 13,
  fontWeight: 600,
};

const successBoxStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  color: "#166534",
  fontSize: 12,
  fontWeight: 600,
  border: "1px solid rgba(22, 163, 74, 0.24)",
  borderRadius: 6,
  background: "#f0fdf4",
  padding: 8,
};

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  minHeight: 32,
  borderBottom: "1px solid rgba(100, 116, 139, 0.14)",
  fontSize: 12,
};

const userRowStyle: React.CSSProperties = {
  ...rowStyle,
  gridTemplateColumns: "minmax(0, 1fr) auto auto",
};

const dangerButtonStyle: React.CSSProperties = {
  borderColor: "#64748b",
  color: "#000000",
};

const profileGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  gap: "6px 10px",
  fontSize: 12,
};

const profileLabelStyle: React.CSSProperties = {
  color: "#000000",
  fontWeight: 500,
};

const profileValueStyle: React.CSSProperties = {
  minWidth: 0,
  overflowWrap: "anywhere",
};

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(255,255,255,0.74)",
  zIndex: 120,
  display: "grid",
  placeItems: "center",
  padding: 16,
};

const modalStyle: React.CSSProperties = {
  width: "min(420px, 100%)",
  borderRadius: 8,
  border: "1px solid rgba(100,116,139,0.68)",
  background: "#ffffff",
  color: "#000000",
  padding: 12,
  display: "grid",
  gap: 10,
  boxShadow: "0 0 0 1px rgba(100, 116, 139, 0.12) inset, 0 18px 42px rgba(0, 0, 0, 0.18)",
};

function companyUserLabel(user: CompanyUser): string {
  const name = (user.display_name ?? "").trim();
  if (name && user.email) return `${name} <${user.email}>`;
  return name || user.email || user.user_id;
}
