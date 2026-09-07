import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmActionMenu, confirmMenuPositionFromElement, type ConfirmActionMenuPosition } from "../app/ConfirmActionMenu";
import { preloadAccountManagerSurface, preloadEntitiesSurface, preloadHomeSurface, preloadLikelyDashboardModules, preloadLogicGateArenaSurface, preloadMyWorkSurface, preloadProcessMapSurface, preloadProjectManagementSurface, preloadTeamsSurface } from "../app/preloadDashboardModules";
import { HeaderRecycleBinIcon, HeaderSettingsIcon } from "../icons/index.js";
import { MangoWordmark } from "../icons/index.js";
import { getActiveCompanyID, getStoredActiveCompanyID, setActiveCompanyID } from "./currentCompany";
import {
  acceptInvitation,
  addAuthTerminalFailureListener,
  apiFetchJSON,
  changePassword,
  completeNewPassword,
  fetchCurrentUser,
  formatAuthError,
  forgotPassword,
  hasStoredToken,
  isAuthEnabled,
  readAuthConfig,
  loginWithPassword,
  logout,
  resetPassword,
  resendSignupConfirmation,
  signUpWithPassword,
  waitForSignupConfirmation,
  validateInvitationToken,
  type CurrentUserResponse,
  type LoginResult,
} from "./cognitoAuth";
import { isAuthPath, nextPathAfterAuthentication, nextPathForAuthState } from "./authRoutes";
import { listCompanyUsers, markCommunicationsWorkspaceResourcesStale } from "../modules/communications/communicationsApi";
import { normalizeAppPath, parseDeepLinkRoute } from "../app/deepLinkRoutes";
import { RecycleBinPage } from "../pages/recycle-bin/RecycleBinPage";
import { RealtimeHealthChrome } from "../modules/realtime/RealtimeHealthChrome";

type PendingChallenge = Extract<LoginResult, { status: "new_password_required" }> | null;
type AppLayoutModule = typeof import("../app/applayout");
type NavigateOptions = { replace?: boolean };

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
  const route = parseDeepLinkRoute(path);
  if (path === "/logic-gate-arena" || route?.kind === "logic_gate") {
    preloadLogicGateArenaSurface();
    return;
  }
  if (path === "/home" || path === "/communication" || path === "/communications" || route?.kind === "gvic") {
    preloadHomeSurface();
    return;
  }
  if (path === "/my-work") {
    preloadMyWorkSurface();
    return;
  }
  if (path === "/project-management") {
    preloadProjectManagementSurface();
    return;
  }
  if (route?.kind === "process_map") {
    preloadProcessMapSurface();
    return;
  }
  if (path === "/account-manager") {
    preloadAccountManagerSurface();
    return;
  }
  if (path === "/teams") {
    preloadTeamsSurface();
    return;
  }
  if (path === "/entities") {
    preloadEntitiesSurface();
    return;
  }
  if (route?.kind === "node") preloadAppLayout();
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
const projectManagementPrefetch = prefetchHandlers(preloadProjectManagementSurface);
const accountManagerPrefetch = prefetchHandlers(preloadAccountManagerSurface);
const teamsPrefetch = prefetchHandlers(preloadTeamsSurface);
const entitiesPrefetch = prefetchHandlers(preloadEntitiesSurface);
const AUTH_RETURN_PATH_KEY = "mangorts:auth-return-path-v1";
const AUTH_RETURN_STATIC_PATHS = new Set([
  "/",
  "/home",
  "/communication",
  "/communications",
  "/logic-gate-arena",
  "/my-work",
  "/project-management",
  "/account-manager",
  "/teams",
  "/entities",
  "/settings",
  "/admin/users",
  "/recycle-bin",
  "/connect-google",
]);

type CompanyUser = {
  company_id: string;
  user_id: string;
  email: string;
  display_name?: string;
  role: string;
};

type CompanyUserOnboarding = {
  company_id: string;
  email: string;
  role: string;
  user_id?: string;
  display_name?: string;
  invitation_id?: string;
  invitation_status: string;
  cognito_status: string;
  invite_email_status: string;
  invite_email_error?: string;
  invite_accepted: boolean;
  google_connection_status: "connected" | "not_connected" | "reauth_required" | "configuration_required" | string;
  google_connection_account_email?: string;
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

type CommunicationsStatus = {
  configured: boolean;
  connected: boolean;
  status: "connected" | "disconnected" | "reauth_required" | "configuration_required" | string;
  connection?: {
    provider?: string;
    account_email?: string;
    scope?: string;
    status?: string;
  };
};

function canUseAuthReturnPath(pathname: string): boolean {
  const path = normalizeAppPath(pathname);
  return AUTH_RETURN_STATIC_PATHS.has(path) || parseDeepLinkRoute(path) !== null;
}

function rememberAuthReturnPath(pathname: string): void {
  if (typeof sessionStorage === "undefined" || !canUseAuthReturnPath(pathname)) return;
  try {
    sessionStorage.setItem(AUTH_RETURN_PATH_KEY, normalizeAppPath(pathname));
  } catch {
    // Session storage can be unavailable in locked-down browser modes.
  }
}

function consumeAuthReturnPath(): string {
  if (typeof sessionStorage === "undefined") return "";
  try {
    const path = sessionStorage.getItem(AUTH_RETURN_PATH_KEY) ?? "";
    sessionStorage.removeItem(AUTH_RETURN_PATH_KEY);
    if (!path.trim()) return "";
    return canUseAuthReturnPath(path) ? normalizeAppPath(path) : "";
  } catch {
    return "";
  }
}

type InviteCreateResponse = {
  invitation: {
    token?: string;
    cognito_status?: string;
    invite_email_status?: string;
    invite_email_error?: string;
  };
  invite_email_status?: string;
  invite_email_error?: string;
  delivery_ok?: boolean;
};

const INVITE_ROLE_OPTIONS: SettingsSelectOption[] = [
  { value: "company_user", label: "company_user" },
  { value: "company_manager", label: "company_manager" },
  { value: "company_admin", label: "company_admin" },
];

const COMPANY_SEARCH_LIMIT = 100;

const panelStyle: React.CSSProperties = {
  width: "100%",
  height: "100dvh",
  display: "flex",
  flexDirection: "column",
  padding: 24,
  overflowY: "auto",
  background:
    "linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(242,245,250,0.92) 42%, rgba(232,237,246,0.96) 100%)",
  color: "#111827",
  fontFamily: "var(--mango-font-family)",
};

const formStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 456,
  margin: "auto",
  flexShrink: 0,
  display: "grid",
  gap: 16,
  padding: 24,
  border: "1px solid rgba(255, 255, 255, 0.84)",
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.94) 0%, rgba(246, 247, 251, 0.9) 100%)",
  borderRadius: 8,
  boxShadow: "12px 12px 30px rgba(174, 174, 192, 0.30), -10px -10px 24px rgba(255, 255, 255, 0.96), inset 1px 1px 0 rgba(255, 255, 255, 0.92)",
  backdropFilter: "blur(16px) saturate(1.08)",
  WebkitBackdropFilter: "blur(16px) saturate(1.08)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 42,
  border: "1px solid rgba(255, 255, 255, 0.82)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.96) 0%, rgba(246, 247, 251, 0.92) 100%)",
  color: "#111827",
  font: "inherit",
  fontSize: 13,
  fontWeight: 520,
  outline: "none",
  padding: "0 12px",
  boxShadow: "inset 3px 3px 7px rgba(174, 174, 192, 0.22), inset -3px -3px 7px rgba(255, 255, 255, 0.92), 0 0 0 1px rgba(100, 116, 139, 0.08)",
};

const buttonStyle: React.CSSProperties = {
  minHeight: 42,
  border: "1px solid transparent",
  borderRadius: 8,
  background:
    "linear-gradient(145deg, rgba(255, 255, 255, 0.97) 0%, rgba(247, 248, 252, 0.92) 100%) padding-box, linear-gradient(135deg, rgba(92, 238, 255, 0.92) 0%, rgba(128, 216, 255, 0.82) 34%, rgba(183, 124, 255, 0.88) 72%, rgba(255, 255, 255, 0.86) 100%) border-box",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontSize: 13,
  fontWeight: 760,
  letterSpacing: 0,
  padding: "0 14px",
  boxShadow: "7px 7px 16px rgba(174, 174, 192, 0.28), -5px -5px 13px rgba(255, 255, 255, 0.94), 0 0 15px rgba(183, 124, 255, 0.16), inset 1px 1px 0 rgba(255, 255, 255, 0.9)",
};

const authHeaderStyle: React.CSSProperties = {
  display: "grid",
  gap: 11,
};

const authAccentRailStyle: React.CSSProperties = {
  height: 5,
  borderRadius: 999,
  background: "var(--mango-brand-gradient)",
  boxShadow: "0 9px 20px rgba(255, 136, 32, 0.22), inset 1px 1px 0 rgba(255, 255, 255, 0.42)",
};

const authFormStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
};

const authFieldStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  minWidth: 0,
};

const authFieldLabelStyle: React.CSSProperties = {
  color: "rgba(15, 23, 42, 0.68)",
  fontSize: 11,
  fontWeight: 760,
  letterSpacing: 0,
};

const authActionRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
};

const authErrorStyle: React.CSSProperties = {
  color: "#be123c",
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1.4,
  border: "1px solid rgba(225, 29, 72, 0.24)",
  borderRadius: 8,
  background: "linear-gradient(135deg, rgba(255, 241, 242, 0.96), rgba(255, 247, 237, 0.72))",
  padding: "9px 10px",
  boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.78)",
};

const authInfoMessageStyle: React.CSSProperties = {
  color: "#334155",
  fontSize: 12,
  fontWeight: 650,
  lineHeight: 1.4,
  border: "1px solid rgba(100, 116, 139, 0.18)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.86), rgba(241, 245, 249, 0.72))",
  padding: "9px 10px",
  boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.82)",
};

const authSuccessMessageStyle: React.CSSProperties = {
  color: "#047857",
  fontSize: 12,
  fontWeight: 760,
  lineHeight: 1.4,
  border: "1px solid rgba(5, 150, 105, 0.24)",
  borderRadius: 8,
  background: "linear-gradient(135deg, rgba(236, 253, 245, 0.96), rgba(224, 242, 254, 0.72))",
  padding: "9px 10px",
  boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.82)",
};

export default function AuthGate() {
  const authEnabled = isAuthEnabled();
  const [path, setPath] = useState(() => window.location.pathname);
  const [me, setMe] = useState<CurrentUserResponse | null>(null);
  const [loading, setLoading] = useState(authEnabled && hasStoredToken());
  const [error, setError] = useState("");
  const [pendingChallenge, setPendingChallenge] = useState<PendingChallenge>(null);

  const navigate = useCallback((nextPath: string, options?: NavigateOptions) => {
    const normalizedNextPath = normalizeAppPath(nextPath.trim() || "/");
    preloadRouteSurface(normalizedNextPath);
    if (window.location.pathname !== normalizedNextPath) {
      if (options?.replace) window.history.replaceState({}, "", normalizedNextPath);
      else window.history.pushState({}, "", normalizedNextPath);
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
      if (!current.is_dev_admin && current.memberships.length === 0) {
        throw new Error("Your company could not be loaded. Please try signing in again.");
      }
      setMe(current);
      const storedCompanyID = getStoredActiveCompanyID();
      const storedCompanyAllowed = storedCompanyID && (current.is_dev_admin || current.memberships.some((item) => item.company_id === storedCompanyID));
      if (!storedCompanyAllowed) {
        const companyID = current.memberships.find((item) => item.role !== "dev_admin")?.company_id ?? current.memberships[0]?.company_id;
        if (companyID) setActiveCompanyID(companyID);
      }
      const returnPath = isAuthPath(window.location.pathname) ? consumeAuthReturnPath() : "";
      const nextPath = nextPathAfterAuthentication(window.location.pathname, returnPath);
      if (nextPath !== window.location.pathname) navigate(nextPath);
    } catch (loadError) {
      setMe(null);
      setError(formatAuthError(loadError, "Could not open Mango"));
      if (!isAuthPath(window.location.pathname)) {
        rememberAuthReturnPath(window.location.pathname);
      }
      navigate("/login");
      throw loadError;
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
      if (nextPath !== window.location.pathname) {
        rememberAuthReturnPath(window.location.pathname);
        navigate(nextPath);
      }
      return;
    }
    void loadMe().catch(() => {});
  }, [authEnabled, loadMe, navigate]);

  useEffect(() => {
    if (!authEnabled) return undefined;
    return addAuthTerminalFailureListener(() => {
      setMe(null);
      setLoading(false);
      setError("");
      if (!isAuthPath(window.location.pathname)) rememberAuthReturnPath(window.location.pathname);
      navigate("/login", { replace: true });
    });
  }, [authEnabled, navigate]);

  const normalizedPath = normalizeAppPath(path);
  const deepLinkRoute = parseDeepLinkRoute(normalizedPath);
  const deepLinkInitialPage = deepLinkRoute?.kind === "process_map"
    ? "process-map"
    : deepLinkRoute?.kind === "logic_gate"
      ? "logic-gate-arena"
      : deepLinkRoute?.kind === "gvic"
        ? "home"
        : normalizedPath === "/my-work"
          ? "my-work"
          : deepLinkRoute?.kind === "project" || normalizedPath === "/project-management"
          ? "project-management"
          : normalizedPath === "/account-manager"
            ? "account-manager"
            : normalizedPath === "/teams"
              ? "teams"
              : normalizedPath === "/entities"
                ? "entities"
                : undefined;

  if (!authEnabled) {
    return (
      <React.Suspense fallback={routeFallback}>
        <LazyAppLayout initialPage={deepLinkInitialPage} deepLink={deepLinkRoute} onNavigate={navigate} />
      </React.Suspense>
    );
  }
  if (loading) return <AuthPanel title="MangoRTS" error={error}><div>Loading</div></AuthPanel>;

  if (!me || isAuthPath(normalizedPath)) {
    if (normalizedPath === "/accept-invite") {
      return <AcceptInvitePage me={me} onAuthenticated={loadMe} onNavigate={navigate} />;
    }
    if (normalizedPath === "/complete-account") {
      return <CompleteAccountPage pendingChallenge={pendingChallenge} onChallenge={setPendingChallenge} onAuthenticated={loadMe} onNavigate={navigate} />;
    }
    if (normalizedPath === "/forgot-password") {
      return <ForgotPasswordPage onNavigate={navigate} />;
    }
    if (normalizedPath === "/reset-password") {
      return <ForgotPasswordPage onNavigate={navigate} initialCodeEntryOpen />;
    }
    return <LoginPage onChallenge={setPendingChallenge} onAuthenticated={loadMe} onNavigate={navigate} loadError={error} />;
  }

  if (normalizedPath === "/settings" || normalizedPath === "/admin/users") {
    return <React.Suspense fallback={routeFallback}><LazyAppLayout accountChrome={<AccountBar me={me} onNavigate={navigate} />} me={me} onNavigate={navigate} overrideContent={<SettingsPage me={me} onNavigate={navigate} onLogout={() => logoutAndNavigate(navigate)} embedded />} /></React.Suspense>;
  }

  if (normalizedPath === "/recycle-bin") {
    return <React.Suspense fallback={routeFallback}><LazyAppLayout accountChrome={<AccountBar me={me} onNavigate={navigate} />} me={me} onNavigate={navigate} overrideContent={<RecycleBinPage embedded />} /></React.Suspense>;
  }

  if (normalizedPath === "/connect-google" && me.user.mailbox_enabled) {
    return <ConnectGooglePage onNavigate={navigate} onLogout={() => logoutAndNavigate(navigate)} />;
  }

  if (normalizedPath === "/logic-gate-arena") {
    return <React.Suspense fallback={routeFallback}><LazyAppLayout accountChrome={<AccountBar me={me} onNavigate={navigate} />} me={me} onNavigate={navigate} initialPage="logic-gate-arena" /></React.Suspense>;
  }

  if (normalizedPath === "/my-work") {
    return <React.Suspense fallback={routeFallback}><LazyAppLayout accountChrome={<AccountBar me={me} onNavigate={navigate} />} me={me} onNavigate={navigate} initialPage="my-work" /></React.Suspense>;
  }

  if (normalizedPath === "/project-management") {
    return <React.Suspense fallback={routeFallback}><LazyAppLayout accountChrome={<AccountBar me={me} onNavigate={navigate} />} me={me} onNavigate={navigate} initialPage="project-management" /></React.Suspense>;
  }

  if (normalizedPath === "/account-manager") {
    return <React.Suspense fallback={routeFallback}><LazyAppLayout accountChrome={<AccountBar me={me} onNavigate={navigate} />} me={me} onNavigate={navigate} initialPage="account-manager" /></React.Suspense>;
  }

  if (normalizedPath === "/teams") {
    return <React.Suspense fallback={routeFallback}><LazyAppLayout accountChrome={<AccountBar me={me} onNavigate={navigate} />} me={me} onNavigate={navigate} initialPage="teams" /></React.Suspense>;
  }
  if (normalizedPath === "/entities") {
    return <React.Suspense fallback={routeFallback}><LazyAppLayout accountChrome={<AccountBar me={me} onNavigate={navigate} />} me={me} onNavigate={navigate} initialPage="entities" /></React.Suspense>;
  }


  if (normalizedPath === "/home" || normalizedPath === "/communications" || normalizedPath === "/communication") {
    return <React.Suspense fallback={routeFallback}><LazyAppLayout accountChrome={<AccountBar me={me} onNavigate={navigate} />} me={me} onNavigate={navigate} initialPage="home" /></React.Suspense>;
  }

  if (deepLinkRoute) {
    return (
      <React.Suspense fallback={routeFallback}>
        <LazyAppLayout
          accountChrome={<AccountBar me={me} onNavigate={navigate} />}
          me={me}
          onNavigate={navigate}
          initialPage={deepLinkInitialPage}
          deepLink={deepLinkRoute}
        />
      </React.Suspense>
    );
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

function inviteStatusMessage(payload: InviteCreateResponse): string {
  const cognitoStatus = payload.invitation.cognito_status;
  const emailStatus = payload.invite_email_status || payload.invitation.invite_email_status || "not_configured";
  if (emailStatus === "sent") {
    if (cognitoStatus === "existing_mango_user") return "Invite email sent. The user can accept with their existing Mango password.";
    return "Invite email sent with the accept link.";
  }
  if (emailStatus === "failed") {
    return "The invitation was created, but its email could not be sent. Please try sending the invitation again.";
  }
  return "Mango invite created. Invite email delivery is not configured.";
}

function formatInviteError(error: unknown): string {
  if (error instanceof Error && error.message.trim() === "This user already exists.") {
    return "This user already exists.";
  }
  return formatAuthError(error, "Invite failed");
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

function settingsOptionSurface(selected: boolean): React.CSSProperties {
  return selected
    ? { background: SETTINGS_SELECTED_BACKGROUND, boxShadow: SETTINGS_SELECTED_SHADOW }
    : { background: "transparent" };
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
        className="mango-settings-select-button"
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((nextOpen) => !nextOpen)}
        style={open ? { ...settingsSelectButtonStyle, background: SETTINGS_SELECTED_BACKGROUND, borderColor: "transparent", boxShadow: SETTINGS_SELECTED_SHADOW } : settingsSelectButtonStyle}
      >
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected?.label ?? "Select"}</span>
        <span aria-hidden="true" style={{ display: "grid", placeItems: "center", color: SETTINGS_MUTED }}>
          <SettingsDisclosureIcon open={open} />
        </span>
      </button>
      {open && (
        <div role="listbox" aria-label={ariaLabel} className="company-explorer-scroll" style={settingsMenuStyle}>
          {options.map((option) => {
            const selectedOption = option.value === value;
            return (
              <button
                className="mango-settings-option"
                key={option.value}
                type="button"
                role="option"
                aria-selected={selectedOption}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={{ ...settingsOptionButtonStyle, ...settingsOptionSurface(selectedOption) }}
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
          className="mango-settings-input"
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
        <span aria-hidden="true" style={{ position: "absolute", right: 34, top: 13, color: SETTINGS_MUTED, pointerEvents: "none" }}>
          <SettingsSearchIcon />
        </span>
        <button
          className="mango-settings-combo-button"
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
                className="mango-settings-option"
                key={company.company_id}
                type="button"
                role="option"
                aria-selected={selectedOption}
                title={company.company_id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectCompany(company)}
                style={{ ...settingsCompanyOptionButtonStyle, ...settingsOptionSurface(selectedOption) }}
              >
                <span style={{ minWidth: 0, display: "grid", gap: 2 }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: SETTINGS_TEXT, fontWeight: 700 }}>{companyName(company)}</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: SETTINGS_MUTED, fontSize: 10 }}>{company.company_id}</span>
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

type AuthTextFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "className" | "style"> & {
  label: string;
};

function AuthTextField({ label, id, ...inputProps }: AuthTextFieldProps) {
  const generatedID = React.useId();
  const inputID = id ?? generatedID;
  return (
    <label style={authFieldStyle} htmlFor={inputID}>
      <span style={authFieldLabelStyle}>{label}</span>
      <input id={inputID} className="mango-auth-input" style={inputStyle} {...inputProps} />
    </label>
  );
}

type AuthButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style">;

function AuthPrimaryButton({ children, ...buttonProps }: AuthButtonProps) {
  return (
    <button className="mango-auth-primary" style={buttonStyle} {...buttonProps}>
      {children}
    </button>
  );
}

function AuthSecondaryButton({ children, ...buttonProps }: AuthButtonProps) {
  return (
    <button className="mango-auth-secondary" style={linkButtonStyle} {...buttonProps}>
      {children}
    </button>
  );
}

function LoginPage({ onChallenge, onAuthenticated, onNavigate, loadError }: { onChallenge: (challenge: PendingChallenge) => void; onAuthenticated: () => Promise<void>; onNavigate: (path: string) => void; loadError?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [message, setMessage] = useState("");
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"signup" | "signin" | null>(null);
  const [resending, setResending] = useState(false);
  const signupRequest = useRef<AbortController | null>(null);
  useEffect(() => () => signupRequest.current?.abort(), []);
  const finishLogin = async (result: LoginResult) => {
    if (result.status === "new_password_required") {
      onChallenge(result);
      onNavigate("/complete-account");
      return;
    }
    await onAuthenticated();
  };
  return (
    <AuthPanel title="MangoRTS" error={error || loadError} wide actions={
      <>
        <AuthSecondaryButton type="button" disabled={busy !== null} onClick={() => onNavigate("/accept-invite")}>Accept invite</AuthSecondaryButton>
        <AuthSecondaryButton type="button" disabled={busy !== null} onClick={() => onNavigate("/forgot-password")}>Forgot password</AuthSecondaryButton>
      </>
    }>
      <div className="mango-auth-columns">
      <form aria-label="Sign Up" style={authFormStyle} onSubmit={async (event) => {
        event.preventDefault();
        const controller = new AbortController();
        signupRequest.current = controller;
        setBusy("signup");
        setError("");
        setMessage("");
        const normalizedEmail = normalizeEmailInput(signupEmail);
        const submittedPassword = signupPassword;
        try {
          await signUpWithPassword(normalizedEmail, submittedPassword, controller.signal);
          setSignupPassword("");
          setConfirmationEmail(normalizedEmail);
          setMessage(`Check your email at ${normalizedEmail}. Keep this page open; it will sign you in after you click the confirmation link.`);
          const result = await waitForSignupConfirmation(normalizedEmail, submittedPassword, controller.signal);
          await finishLogin(result);
        } catch (signupError) {
          if (!controller.signal.aborted) {
            setError(formatAuthError(signupError, "Signup could not finish"));
            if (signupError instanceof Error && signupError.name === "UsernameExistsException") setConfirmationEmail(normalizedEmail);
          }
        } finally {
          setSignupPassword("");
          if (signupRequest.current === controller) {
            signupRequest.current = null;
            setBusy(null);
          }
        }
      }}>
        <h1 className="mango-auth-section-title">Sign Up</h1>
        <AuthTextField label="Email" value={signupEmail} onChange={(event) => setSignupEmail(event.target.value)} type="email" placeholder="you@company.com" autoComplete="email" required disabled={busy !== null} />
        <AuthTextField label="Create password" value={signupPassword} onChange={(event) => setSignupPassword(event.target.value)} type="password" placeholder="Create password" autoComplete="new-password" required minLength={6} disabled={busy !== null} />
        <AuthPrimaryButton disabled={busy !== null}>{busy === "signup" ? "Waiting for confirmation" : "Sign up"}</AuthPrimaryButton>
      </form>
      <form aria-label="Sign In" style={authFormStyle} onSubmit={async (event) => {
        event.preventDefault();
        setBusy("signin");
        setError("");
        setMessage("");
        try {
          const result = await loginWithPassword(email, password);
          await finishLogin(result);
        } catch (loginError) {
          setError(formatLoginError(loginError));
          if (loginError instanceof Error && loginError.name === "UserNotConfirmedException") setConfirmationEmail(normalizeEmailInput(email));
        } finally {
          setPassword("");
          setBusy(null);
        }
      }}>
        <h1 className="mango-auth-section-title">Sign In</h1>
        <AuthTextField label="Email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@company.com" autoComplete="email" required disabled={busy !== null} />
        <AuthTextField label="Password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Password" autoComplete="current-password" required disabled={busy !== null} />
        <AuthPrimaryButton disabled={busy !== null}>{busy === "signin" ? "Signing in" : "Sign in"}</AuthPrimaryButton>
      </form>
      </div>
      {message && <div role="status" style={authInfoMessageStyle}>{message}</div>}
      {confirmationEmail && <div style={authActionRowStyle}>
        <AuthSecondaryButton type="button" disabled={busy === "signin" || resending} onClick={async () => {
          setError("");
          setResending(true);
          try {
            await resendSignupConfirmation(confirmationEmail);
            setMessage(`A new confirmation link was sent to ${confirmationEmail}.`);
          } catch (resendError) { setError(formatAuthError(resendError, "Could not resend confirmation")); }
          finally { setResending(false); }
        }}>Resend confirmation email</AuthSecondaryButton>
        {busy === "signup" && <AuthSecondaryButton type="button" onClick={() => {
          signupRequest.current?.abort();
          setMessage("You can confirm your email and use Sign In with the password you chose.");
        }}>Stop waiting</AuthSecondaryButton>}
      </div>}
    </AuthPanel>
  );
}

function CompleteAccountPage({ pendingChallenge, onChallenge, onAuthenticated, onNavigate }: { pendingChallenge: PendingChallenge; onChallenge: (challenge: PendingChallenge) => void; onAuthenticated: () => Promise<void>; onNavigate: (path: string) => void }) {
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!pendingChallenge) {
    return (
      <AuthPanel title="Complete Account" error={error}>
        <div style={authInfoMessageStyle}>Sign in first to complete account setup.</div>
        <AuthSecondaryButton type="button" onClick={() => onNavigate("/login")}>Back to login</AuthSecondaryButton>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title="Complete Account" error={error}>
      <form style={authFormStyle} onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          if (!newPassword.trim()) {
            throw new Error("Enter a new password.");
          }
          await completeNewPassword(pendingChallenge.username, pendingChallenge.session, newPassword);
          onChallenge(null);
          await onAuthenticated();
        } catch (completeError) {
          console.error("Account completion failed", completeError);
          setError(formatAuthError(completeError, "Account completion failed"));
        } finally {
          setBusy(false);
        }
      }}>
        <div style={authInfoMessageStyle}>Account setup for {pendingChallenge.username}.</div>
        <AuthTextField label="New password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" placeholder="New password" autoComplete="new-password" />
        <AuthPrimaryButton disabled={busy}>{busy ? "Completing" : "Complete account"}</AuthPrimaryButton>
      </form>
      <AuthSecondaryButton type="button" onClick={() => onNavigate("/login")}>Back to login</AuthSecondaryButton>
    </AuthPanel>
  );
}

function AcceptInvitePage({ me, onAuthenticated, onNavigate }: { me: CurrentUserResponse | null; onAuthenticated: () => Promise<void>; onNavigate: (path: string) => void }) {
  const token = new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
  const [invitation, setInvitation] = useState<Awaited<ReturnType<typeof validateInvitationToken>> | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    validateInvitationToken(token).then((value) => {
      if (!cancelled) {
        setInvitation(value);
        setEmail(value.email);
      }
    }).catch((validationError) => {
      if (!cancelled) setError(formatAuthError(validationError, "Invitation unavailable"));
    });
    return () => { cancelled = true; };
  }, [token]);
  const wrongAccount = Boolean(me && invitation && normalizeEmailInput(me.user.email) !== normalizeEmailInput(invitation.email));
  return (
    <AuthPanel title="Accept Invite" error={error}>
      <h1 className="mango-auth-section-title">Join {invitation?.company_name || "a company"}</h1>
      {!token && <div style={authInfoMessageStyle}>Open the invitation link in your email to join a company.</div>}
      {token && !invitation && !error && <div role="status">Loading invitation…</div>}
      {invitation && <form aria-label="Accept invitation" style={authFormStyle} onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          const normalizedEmail = normalizeEmailInput(email);
          if (normalizedEmail !== normalizeEmailInput(invitation.email)) throw new Error("Use the email address this invitation was sent to.");
          let accepted;
          if (me) {
            if (wrongAccount) throw new Error("Sign in with the invited email address before accepting.");
            accepted = await acceptInvitation(token, me.user.display_name);
          } else if (invitation.account_exists) {
            const result = await loginWithPassword(normalizedEmail, password);
            if (result.status === "new_password_required") {
              await completeNewPassword(result.username, result.session, password);
            }
            accepted = await acceptInvitation(token, "");
          } else {
            accepted = await acceptInvitation(token, "", normalizedEmail, password);
            const result = await loginWithPassword(normalizedEmail, password);
            if (result.status !== "authenticated") throw new Error("Your invitation was accepted. Sign in to continue.");
          }
          setActiveCompanyID(accepted.company_id);
          await onAuthenticated();
          onNavigate("/my-work");
        } catch (inviteError) {
          if ((inviteError as { code?: string })?.code === "existing_account_sign_in_required") {
            setInvitation({ ...invitation, account_exists: true });
          }
          if (inviteError instanceof Error && inviteError.name === "UserNotConfirmedException") setNeedsConfirmation(true);
          setError(formatAuthError(inviteError, "Could not accept invitation"));
        } finally {
          setPassword("");
          setBusy(false);
        }
      }}>
        <div style={authInfoMessageStyle}>You were invited as {invitation.role.replace(/_/g, " ")}. {invitation.account_exists ? "Your existing company memberships will stay available." : "Create your password to finish signing up."}</div>
        <AuthTextField label="Email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required readOnly />
        {!me && <AuthTextField label={invitation.account_exists ? "Password" : "Create password"} value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={invitation.account_exists ? "current-password" : "new-password"} required />}
        {wrongAccount && <div role="alert" style={authErrorStyle}>This invitation is for {invitation.email}. Sign out to use that account.</div>}
        <AuthPrimaryButton disabled={busy || wrongAccount}>{busy ? "Joining" : "Join company"}</AuthPrimaryButton>
      </form>}
      {message && <div role="status" style={authInfoMessageStyle}>{message}</div>}
      {needsConfirmation && invitation && <AuthSecondaryButton type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        setError("");
        try {
          await resendSignupConfirmation(invitation.email);
          setMessage("Confirmation email sent. Confirm it, then enter your password to join this company.");
        } catch (resendError) { setError(formatAuthError(resendError, "Could not resend confirmation")); }
        finally { setBusy(false); }
      }}>Resend confirmation email</AuthSecondaryButton>}
      {wrongAccount && <AuthSecondaryButton type="button" onClick={() => {
        const invitationURL = window.location.href;
        logout();
        window.location.replace(invitationURL);
      }}>Sign out</AuthSecondaryButton>}
      <AuthSecondaryButton type="button" onClick={() => onNavigate(me ? "/my-work" : "/login")}>{me ? "Back to Mango" : "Back to Sign In"}</AuthSecondaryButton>
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
      <form style={authFormStyle} onSubmit={async (event) => {
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
        <AuthTextField label="Email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@company.com" autoComplete="email" />
        <AuthPrimaryButton disabled={busy}>{busy ? "Sending" : "Send reset code"}</AuthPrimaryButton>
      </form>
      {message && <div style={authInfoMessageStyle}>{message}</div>}
      {codeEntryOpen && (
        <form style={authFormStyle} onSubmit={async (event) => {
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
          <AuthTextField label="Reset code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Reset code" autoComplete="one-time-code" />
          <AuthTextField label="New password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="New password" autoComplete="new-password" />
          <AuthPrimaryButton disabled={busy}>{busy ? "Submitting" : "Submit"}</AuthPrimaryButton>
        </form>
      )}
      {success && <div style={authSuccessMessageStyle}>{success}</div>}
      <AuthSecondaryButton type="button" onClick={() => onNavigate("/login")}>Back to login</AuthSecondaryButton>
    </AuthPanel>
  );
}

function ConnectGooglePage({ onNavigate, onLogout }: { onNavigate: (path: string) => void; onLogout: () => void }) {
  const [status, setStatus] = useState<CommunicationsStatus | null>(null);
  const [error, setError] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("nylas_error")?.trim() ?? "";
    return code ? formatAuthError(new Error(code), "Google connection failed") : "";
  });
  const [busy, setBusy] = useState(false);
  const googleConnected = status?.connected && status.connection?.provider === "google" && status.status === "connected";

  useEffect(() => {
    let cancelled = false;
    apiFetchJSON<CommunicationsStatus>("/v1/communications/status")
      .then((payload) => {
        if (cancelled) return;
        setStatus(payload);
        if (payload.connected && payload.connection?.provider === "google" && payload.status === "connected") onNavigate("/my-work");
      })
      .catch((statusError) => {
        if (!cancelled) setError(formatAuthError(statusError, "Could not load Google connection status"));
      });
    return () => {
      cancelled = true;
    };
  }, [onNavigate]);

  const startGoogleConnection = async () => {
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({ provider: "google" });
      const payload = await apiFetchJSON<{ auth_url: string }>(`/v1/communications/auth-url?${query.toString()}`);
      window.location.assign(payload.auth_url);
    } catch (connectError) {
      setError(formatAuthError(connectError, "Could not start Google connection"));
      setBusy(false);
    }
  };

  const unavailable = status && !status.configured;
  const configurationRequired = status?.status === "configuration_required";
  return (
    <AuthPanel title="Connect Google" error={error}>
      <div style={authFormStyle}>
        <div style={authInfoMessageStyle}>
          {googleConnected
            ? "Google connected."
            : unavailable
              ? "Google connection is not configured for this environment."
              : configurationRequired
                ? "Google/Gmail configuration needs attention before mail syncing can resume."
                : "Connect Google to finish Mango onboarding."}
        </div>
        {!unavailable && !googleConnected && (
          <AuthPrimaryButton type="button" disabled={busy} onClick={() => void startGoogleConnection()}>
            {busy ? "Connecting" : status?.status === "reauth_required" || configurationRequired ? "Reconnect Google" : "Connect Google"}
          </AuthPrimaryButton>
        )}
        <div style={authActionRowStyle}>
          <AuthSecondaryButton type="button" onClick={() => onNavigate("/my-work")}>Continue</AuthSecondaryButton>
          <AuthSecondaryButton type="button" onClick={onLogout}>Logout</AuthSecondaryButton>
        </div>
      </div>
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
  const canManageSelectedCompany = Boolean(companyID) && (me.is_dev_admin || selectedCompany?.role === "company_admin" || selectedCompany?.role === "company_manager");
  const canInviteCompanyAdmins = me.is_dev_admin || (Boolean(companyID) && selectedCompany?.role === "company_admin");
  const inviteRoleOptions = useMemo(
    () => canInviteCompanyAdmins ? INVITE_ROLE_OPTIONS : INVITE_ROLE_OPTIONS.filter((option) => option.value !== "company_admin"),
    [canInviteCompanyAdmins],
  );
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [onboarding, setOnboarding] = useState<CompanyUserOnboarding[]>([]);
  const [inviteCompanyID, setInviteCompanyID] = useState(() => companyID);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("company_user");
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
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ user: CompanyUser; position?: ConfirmActionMenuPosition | null } | null>(null);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState("");
  const inviteSelectedCompany = companyOptions.find((company) => company.company_id === inviteCompanyID) ?? null;
  const activeCompanyLabel = selectedCompany ? companyName(selectedCompany) : companyID ? "Selected company" : "No company selected";
  const canInvite = me.is_dev_admin || canManageSelectedCompany;
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
      setOnboarding([]);

      setError("");
      return;
    }
    setError("");
    const [usersResult, onboardingResult] = await Promise.allSettled([
      listCompanyUsers(companyID),
      apiFetchJSON<{ onboarding: CompanyUserOnboarding[] }>(`/v1/companies/${encodeURIComponent(companyID)}/onboarding`),
    ]);
    if (usersResult.status === "rejected") {
      console.error("Company users load failed", usersResult.reason);
      setUsers([]);
      setOnboarding([]);

      setError(formatAuthError(usersResult.reason, "Failed to load users"));
      return;
    }
    setUsers(usersResult.value.map((user) => ({ ...user, email: user.email ?? "", role: user.role ?? "company_user" })));

    const warnings: string[] = [];
    if (onboardingResult.status === "fulfilled") {
      setOnboarding(onboardingResult.value.onboarding ?? []);
    } else {
      console.error("User onboarding load failed", onboardingResult.reason);
      setOnboarding([]);
      warnings.push("User onboarding status could not be loaded.");
    }

    setError(warnings.join(" "));
  }, [canManageSelectedCompany, companyID]);

  useEffect(() => { void loadCompanyOptions(""); }, [loadCompanyOptions]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (companyID) setActiveCompanyID(companyID); }, [companyID]);
  useEffect(() => {
    if (!me.is_dev_admin) setInviteCompanyID(companyID);
    else if (!inviteCompanyID && companyID) setInviteCompanyID(companyID);
  }, [companyID, inviteCompanyID, me.is_dev_admin]);
  useEffect(() => {
    if (!canInviteCompanyAdmins && inviteRole === "company_admin") {
      setInviteRole("company_manager");
    }
  }, [canInviteCompanyAdmins, inviteRole]);
  return (
    <div style={embedded ? { ...settingsPageStyle, minHeight: "100%", boxSizing: "border-box" } : settingsPageStyle}>
      <div style={settingsHeaderStyle}>
        <h1 style={settingsPageTitleStyle}>Settings</h1>
        {!embedded && <div style={settingsNavStyle}>
          <button className="mango-settings-action" style={smallButtonStyle} onClick={() => onNavigate("/")}>MangoRTS</button>
          <button className="mango-settings-action" style={smallButtonStyle} onClick={() => onNavigate("/logic-gate-arena")} {...logicGateArenaPrefetch}>Process Arena</button>
          <button className="mango-settings-action" style={smallButtonStyle} onClick={() => onNavigate("/project-management")} {...projectManagementPrefetch}>Projects</button>
          <button className="mango-settings-action" style={smallButtonStyle} onClick={() => onNavigate("/account-manager")} {...accountManagerPrefetch}>Accounts</button>
          <button className="mango-settings-action" style={smallButtonStyle} onClick={() => onNavigate("/teams")} {...teamsPrefetch}>Teams</button>
          <button className="mango-settings-action" style={smallButtonStyle} onClick={() => onNavigate("/home")} {...homePrefetch}>Home</button>
          <button className="mango-settings-action" style={smallButtonStyle} onClick={() => onNavigate("/entities")} {...entitiesPrefetch}>Entities</button>
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
            onChange={(nextCompanyID) => {
              if (!nextCompanyID || nextCompanyID === companyID) return;
              setActiveCompanyID(nextCompanyID);
              window.location.assign("/my-work");
            }}
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
                <input className="mango-settings-input" style={settingsInputStyle} value={newCompanyName} onChange={(event) => setNewCompanyName(event.target.value)} placeholder="New company name" />
                <button className="mango-settings-action" style={settingsPrimaryButtonStyle} disabled={companyBusy}>{companyBusy ? "Creating" : "Create new company"}</button>
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
            if (!targetCompanyID) {
              setError("Invite company required");
              return;
            }
            if (!normalizedInviteEmail) {
              setError("Email required");
              return;
            }
            try {
              const payload = await apiFetchJSON<InviteCreateResponse>("/v1/invitations", {
                method: "POST",
                body: JSON.stringify({ company_id: targetCompanyID, email: normalizedInviteEmail, role: inviteRole }),
              });
              setInviteMessage(inviteStatusMessage(payload));
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
            <input className="mango-settings-input" style={settingsInputStyle} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value.toLowerCase())} type="email" placeholder="Email" />
            <SettingsSelect value={inviteRole} options={inviteRoleOptions} onChange={setInviteRole} ariaLabel="User role" />
            <button className="mango-settings-action" style={settingsPrimaryButtonStyle}>Invite user</button>
          </form>
          {inviteMessage && <div style={settingsInfoTextStyle}>{inviteMessage}</div>}
        </section>}
        <section style={{ ...sectionStyle, flex: me.is_dev_admin ? "0 1 360px" : "1 1 280px", marginLeft: me.is_dev_admin ? "auto" : undefined }}>
          <div style={settingsProfileHeaderStyle}>
            <h2 style={sectionTitleStyle}>User Profile</h2>
            <button className="mango-settings-action" style={smallButtonStyle} onClick={onLogout}>Logout</button>
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
            <input className="mango-settings-input" style={settingsInputStyle} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type="password" placeholder="Current password" autoComplete="current-password" />
            <input className="mango-settings-input" style={settingsInputStyle} value={newSettingsPassword} onChange={(event) => setNewSettingsPassword(event.target.value)} type="password" placeholder="New password" autoComplete="new-password" />
            <input className="mango-settings-input" style={settingsInputStyle} value={confirmSettingsPassword} onChange={(event) => setConfirmSettingsPassword(event.target.value)} type="password" placeholder="Confirm new password" autoComplete="new-password" />
            <button className="mango-settings-action" style={settingsPrimaryButtonStyle} disabled={passwordBusy}>{passwordBusy ? "Changing" : "Change password"}</button>
          </form>
          {passwordError && <div style={settingsErrorSmallStyle}>{passwordError}</div>}
          {passwordMessage && <div style={successMessageStyle}>{passwordMessage}</div>}
        </section>
      </div>
      {canManageSelectedCompany && <section style={{ ...sectionStyle, marginTop: 14 }}>
        <div style={settingsSectionHeaderRowStyle}>
          <h2 style={sectionTitleStyle}>Onboarding</h2>
          <span style={settingsSectionScopeStyle}>{activeCompanyLabel}</span>
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          {onboarding.length === 0 && <div style={settingsInfoTextStyle}>No onboarding activity in this company scope.</div>}
          {onboarding.map((item) => (
            <div key={`${item.email}:${item.user_id ?? item.invitation_id ?? ""}`} style={onboardingRowStyle}>
              <span style={{ minWidth: 0, overflowWrap: "anywhere", fontWeight: 600 }}>{onboardingUserLabel(item)}</span>
              <span>{item.role}</span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {onboardingStatusLabels(item).map((label) => <span key={label} style={statusChipStyle}>{label}</span>)}
              </span>
              {item.invite_email_error && <span style={{ gridColumn: "1 / -1", ...settingsErrorSmallStyle }}>{item.invite_email_error}</span>}
            </div>
          ))}
        </div>
      </section>}
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
          {users.map((user) => {
            const canDeleteUser = user.user_id !== me.user.user_id && (me.is_dev_admin || (user.role !== "dev_admin" && (selectedCompany?.role === "company_admin" || (selectedCompany?.role === "company_manager" && user.role !== "company_admin"))));
            return (
              <div key={user.user_id} style={userRowStyle}>
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{companyUserLabel(user)}</span>
                <span>{user.role}</span>
                <button
                  className="mango-settings-action"
                  type="button"
                  style={{ ...smallButtonStyle, ...dangerButtonStyle }}
                  disabled={!canDeleteUser}
                  onClick={(event) => {
                    setError("");
                    setDeleteAcknowledged(false);
                    setDeleteConfirmation({ user, position: confirmMenuPositionFromElement(event.currentTarget) });
                  }}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      </section>}
      {deleteConfirmation && (
        <ConfirmActionMenu
          title="Are you sure you want to delete this user?"
          detail={me.is_dev_admin
            ? <>This deletes {companyUserLabel(deleteConfirmation.user)} from Cognito and removes their Mango user, memberships, and invitation rows.</>
            : <>This removes {companyUserLabel(deleteConfirmation.user)} from {activeCompanyLabel}. They must keep at least one other company membership.</>}
          position={deleteConfirmation.position}
          confirmLabel={deleteBusy ? "Deleting" : "Yes"}
          cancelLabel="No"
          confirmDisabled={!deleteAcknowledged || deleteBusy}
          onConfirm={async () => {
            if (!companyID || !deleteConfirmation) return;
            const targetUser = deleteConfirmation.user;
            setDeleteBusy(true);
            setError("");
            try {
              await apiFetchJSON(`/v1/companies/${encodeURIComponent(companyID)}/users/${encodeURIComponent(targetUser.user_id)}`, { method: "DELETE" });
              markCommunicationsWorkspaceResourcesStale(companyID, { companyUsers: true });
              setUsers((previous) => previous.filter((user) => user.user_id !== targetUser.user_id));
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
          onCancel={() => {
            setDeleteConfirmation(null);
            setDeleteAcknowledged(false);
          }}
        >
          <label style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 8, alignItems: "start", fontSize: 11, lineHeight: 1.35 }}>
            <input type="checkbox" checked={deleteAcknowledged} onChange={(event) => setDeleteAcknowledged(event.target.checked)} />
            <span>Yes I know what I'm doing I want to delete this user.</span>
          </label>
        </ConfirmActionMenu>
      )}
    </div>
  );
}

function AuthPanel({ error, children, wide = false, actions }: { title: string; error?: string; children: React.ReactNode; wide?: boolean; actions?: React.ReactNode }) {
  return (
    <div style={panelStyle}>
      <div style={wide ? { ...formStyle, maxWidth: 800 } : formStyle}>
        <div style={authHeaderStyle}>
          <div className="mango-auth-header-row">
            <MangoWordmark size={28} weight={680} />
            {actions && <div className="mango-auth-header-actions">{actions}</div>}
          </div>
          <div style={authAccentRailStyle} />
        </div>
        {error && <div role="alert" style={authErrorStyle}>{error}</div>}
        {children}
      </div>
    </div>
  );
}

function AccountBar({ me, onNavigate }: { me: CurrentUserResponse; onNavigate: (path: string) => void }) {
  const displayName = me.user.display_name?.trim() || me.user.email;
  const shellStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
  };
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
    <div style={shellStyle}>
      <RealtimeHealthChrome apiBase={readAuthConfig().apiBase} companyID={getActiveCompanyID()} />
      <button
        type="button"
        aria-label="Recycle Bin"
        title="Recycle Bin"
        style={navButtonStyle}
        onClick={() => onNavigate("/recycle-bin")}
      >
        <HeaderRecycleBinIcon />
      </button>
      <button
        type="button"
        aria-label={`Settings for ${displayName}`}
        title="Settings"
        style={navButtonStyle}
        onClick={() => onNavigate("/settings")}
      >
        <HeaderSettingsIcon />
      </button>
    </div>
  );
}

function logoutAndNavigate(navigate: (path: string) => void): void {
  logout();
  navigate("/login");
}

const SETTINGS_TEXT = "#111827";
const SETTINGS_MUTED = "#475569";
const SETTINGS_SUBTLE = "#64748b";
const SETTINGS_PAGE_BACKGROUND = "linear-gradient(135deg, #f8fafc 0%, #eef3f8 52%, #f7f8fb 100%)";
const SETTINGS_SURFACE = "linear-gradient(145deg, rgba(255, 255, 255, 0.96) 0%, rgba(247, 248, 252, 0.9) 100%)";
const SETTINGS_PANEL_SURFACE = "linear-gradient(180deg, rgba(251, 251, 253, 0.96) 0%, rgba(242, 244, 248, 0.92) 100%)";
const SETTINGS_INSET_SURFACE = "linear-gradient(145deg, rgba(255, 255, 255, 0.92) 0%, rgba(241, 245, 249, 0.76) 100%)";
const SETTINGS_EDGE_GRADIENT = "linear-gradient(135deg, rgba(92, 238, 255, 0.92) 0%, rgba(128, 216, 255, 0.82) 34%, rgba(183, 124, 255, 0.88) 72%, rgba(255, 255, 255, 0.86) 100%)";
const SETTINGS_SELECTED_BACKGROUND = `${SETTINGS_SURFACE} padding-box, ${SETTINGS_EDGE_GRADIENT} border-box`;
const SETTINGS_SOFT_SHADOW = "7px 7px 16px rgba(174, 174, 192, 0.22), -7px -7px 16px rgba(255, 255, 255, 0.9), inset 1px 1px 0 rgba(255, 255, 255, 0.86)";
const SETTINGS_RAISED_SHADOW = "12px 12px 28px rgba(174, 174, 192, 0.28), -10px -10px 24px rgba(255, 255, 255, 0.95), inset 1px 1px 0 rgba(255, 255, 255, 0.9)";
const SETTINGS_SELECTED_SHADOW = "0 0 0 1px rgba(120, 224, 255, 0.18), 0 0 18px rgba(183, 124, 255, 0.24), inset 1px 1px 0 rgba(255, 255, 255, 0.88)";
const SETTINGS_INSET_SHADOW = "inset 3px 3px 7px rgba(174, 174, 192, 0.18), inset -3px -3px 7px rgba(255, 255, 255, 0.9), 0 0 0 1px rgba(100, 116, 139, 0.08)";

const linkButtonStyle: React.CSSProperties = {
  minHeight: 34,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.88) 0%, rgba(246, 247, 251, 0.82) 100%)",
  color: "#334155",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 720,
  letterSpacing: 0,
  padding: "0 12px",
  boxShadow: "5px 5px 12px rgba(174, 174, 192, 0.22), -5px -5px 12px rgba(255, 255, 255, 0.9), inset 1px 1px 0 rgba(255, 255, 255, 0.82)",
};

const smallButtonStyle: React.CSSProperties = {
  minHeight: 34,
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 8,
  background: SETTINGS_SURFACE,
  color: SETTINGS_TEXT,
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 680,
  letterSpacing: 0,
  padding: "0 12px",
  boxShadow: SETTINGS_SOFT_SHADOW,
};

const settingsPageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: SETTINGS_PAGE_BACKGROUND,
  color: SETTINGS_TEXT,
  fontFamily: "var(--mango-font-family)",
  padding: 16,
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
  fontSize: 20,
  color: SETTINGS_TEXT,
  fontWeight: 720,
  letterSpacing: 0,
};

const settingsNavStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  gap: 8,
};

const settingsErrorStyle: React.CSSProperties = {
  color: "#be123c",
  marginBottom: 12,
  fontSize: 12,
  fontWeight: 720,
  lineHeight: 1.4,
  border: "1px solid rgba(225, 29, 72, 0.24)",
  borderRadius: 8,
  background: "linear-gradient(135deg, rgba(255, 241, 242, 0.96), rgba(255, 247, 237, 0.72))",
  padding: "9px 10px",
  boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.78)",
};

const settingsErrorSmallStyle: React.CSSProperties = {
  color: "#be123c",
  fontSize: 12,
  fontWeight: 650,
  lineHeight: 1.35,
};

const settingsInfoTextStyle: React.CSSProperties = {
  color: SETTINGS_MUTED,
  fontSize: 12,
  lineHeight: 1.4,
};

const settingsFieldLabelStyle: React.CSSProperties = {
  color: SETTINGS_MUTED,
  fontSize: 11,
  fontWeight: 720,
};

const settingsInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 40,
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 8,
  background: SETTINGS_SURFACE,
  color: SETTINGS_TEXT,
  font: "inherit",
  fontSize: 13,
  fontWeight: 560,
  padding: "0 12px",
  outline: "none",
  boxShadow: SETTINGS_INSET_SHADOW,
};

const settingsPrimaryButtonStyle: React.CSSProperties = {
  minHeight: 40,
  border: "1px solid transparent",
  borderRadius: 8,
  background: SETTINGS_SELECTED_BACKGROUND,
  color: SETTINGS_TEXT,
  cursor: "pointer",
  font: "inherit",
  fontSize: 13,
  fontWeight: 760,
  letterSpacing: 0,
  padding: "0 14px",
  boxShadow: `${SETTINGS_SOFT_SHADOW}, 0 0 14px rgba(183, 124, 255, 0.16)`,
};

const settingsSelectButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 40,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 18px",
  alignItems: "center",
  gap: 8,
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 8,
  background: SETTINGS_SURFACE,
  color: SETTINGS_TEXT,
  cursor: "pointer",
  font: "inherit",
  fontSize: 13,
  fontWeight: 620,
  padding: "0 12px",
  textAlign: "left",
  boxShadow: SETTINGS_INSET_SHADOW,
};

const settingsComboIconButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 5,
  right: 5,
  width: 30,
  height: 30,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 8,
  background: SETTINGS_SURFACE,
  color: SETTINGS_MUTED,
  cursor: "pointer",
  boxShadow: "4px 4px 9px rgba(174, 174, 192, 0.20), -4px -4px 9px rgba(255, 255, 255, 0.88), inset 1px 1px 0 rgba(255, 255, 255, 0.82)",
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
  padding: 6,
  border: "1px solid transparent",
  borderRadius: 8,
  background: `${SETTINGS_SURFACE} padding-box, ${SETTINGS_EDGE_GRADIENT} border-box`,
  color: SETTINGS_TEXT,
  boxShadow: "0 18px 42px rgba(15, 23, 42, 0.16), 0 0 18px rgba(183, 124, 255, 0.14), inset 1px 1px 0 rgba(255, 255, 255, 0.86)",
  backdropFilter: "blur(14px) saturate(1.12)",
  WebkitBackdropFilter: "blur(14px) saturate(1.12)",
};

const settingsOptionButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 32,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 18px",
  alignItems: "center",
  gap: 8,
  border: "1px solid transparent",
  borderRadius: 6,
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 620,
  padding: "7px 8px",
  textAlign: "left",
  color: SETTINGS_TEXT,
};

const settingsCompanyOptionButtonStyle: React.CSSProperties = {
  ...settingsOptionButtonStyle,
  minHeight: 42,
};

const settingsEmptyOptionStyle: React.CSSProperties = {
  padding: "8px 10px",
  color: SETTINGS_MUTED,
  fontSize: 11,
  fontWeight: 620,
};

const settingsScopePlateStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 8,
  background: SETTINGS_INSET_SURFACE,
  padding: 11,
  boxShadow: SETTINGS_INSET_SHADOW,
};

const settingsScopeKickerStyle: React.CSSProperties = {
  color: SETTINGS_MUTED,
  fontSize: 10,
  fontWeight: 720,
};

const settingsScopeNameStyle: React.CSSProperties = {
  minWidth: 0,
  color: SETTINGS_TEXT,
  fontSize: 15,
  fontWeight: 760,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const settingsScopeUUIDStyle: React.CSSProperties = {
  color: SETTINGS_SUBTLE,
  fontSize: 11,
  overflowWrap: "anywhere",
};

const settingsActiveScopeStyle: React.CSSProperties = {
  border: "1px solid transparent",
  borderRadius: 8,
  background: "linear-gradient(135deg, rgba(255, 255, 255, 0.88), rgba(230, 252, 255, 0.48) 48%, rgba(247, 239, 255, 0.58)) padding-box, linear-gradient(135deg, rgba(92, 238, 255, 0.52), rgba(183, 124, 255, 0.44)) border-box",
  color: SETTINGS_TEXT,
  fontSize: 11,
  fontWeight: 680,
  padding: "7px 8px",
  boxShadow: "inset 1px 1px 0 rgba(255, 255, 255, 0.82), 0 7px 16px rgba(96, 165, 250, 0.08)",
};

const settingsSubsectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  borderTop: "1px solid rgba(148, 163, 184, 0.18)",
  paddingTop: 12,
};

const settingsSubsectionTitleStyle: React.CSSProperties = {
  margin: 0,
  color: SETTINGS_TEXT,
  fontSize: 11,
  fontWeight: 760,
};

const settingsSectionHeaderRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  flexWrap: "wrap",
  gap: 8,
};

const settingsSectionScopeStyle: React.CSSProperties = {
  minWidth: 0,
  color: SETTINGS_MUTED,
  fontSize: 11,
  fontWeight: 620,
};

const sectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
  padding: 14,
  border: "1px solid rgba(255, 255, 255, 0.78)",
  background: SETTINGS_PANEL_SURFACE,
  borderRadius: 8,
  color: SETTINGS_TEXT,
  boxShadow: SETTINGS_RAISED_SHADOW,
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
  color: SETTINGS_TEXT,
  letterSpacing: 0,
  fontWeight: 780,
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
  color: "#047857",
  fontSize: 13,
  fontWeight: 720,
};

const successBoxStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  color: "#047857",
  fontSize: 12,
  fontWeight: 700,
  border: "1px solid rgba(5, 150, 105, 0.24)",
  borderRadius: 8,
  background: "linear-gradient(135deg, rgba(236, 253, 245, 0.96), rgba(224, 242, 254, 0.72))",
  padding: "9px 10px",
  boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.82)",
};

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  minHeight: 36,
  borderBottom: "1px solid rgba(148, 163, 184, 0.16)",
  fontSize: 12,
  color: SETTINGS_TEXT,
};

const userRowStyle: React.CSSProperties = {
  ...rowStyle,
  gridTemplateColumns: "minmax(0, 1fr) auto auto",
};

const onboardingRowStyle: React.CSSProperties = {
  ...rowStyle,
  gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
  alignItems: "start",
  padding: "7px 0",
};

const statusChipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 22,
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 6,
  background: SETTINGS_INSET_SURFACE,
  color: SETTINGS_TEXT,
  fontSize: 11,
  fontWeight: 700,
  padding: "2px 7px",
  boxShadow: "3px 3px 7px rgba(174, 174, 192, 0.18), -3px -3px 7px rgba(255, 255, 255, 0.84), inset 1px 1px 0 rgba(255, 255, 255, 0.8)",
};

const dangerButtonStyle: React.CSSProperties = {
  borderColor: "rgba(225, 29, 72, 0.34)",
  color: "#9f1239",
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(255, 241, 242, 0.82))",
};

const profileGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  gap: "6px 10px",
  fontSize: 12,
};

const profileLabelStyle: React.CSSProperties = {
  color: SETTINGS_MUTED,
  fontWeight: 700,
};

const profileValueStyle: React.CSSProperties = {
  minWidth: 0,
  overflowWrap: "anywhere",
  color: SETTINGS_TEXT,
  fontWeight: 560,
};

function companyUserLabel(user: CompanyUser): string {
  const name = (user.display_name ?? "").trim();
  if (name && user.email) return `${name} <${user.email}>`;
  return name || user.email || user.user_id;
}

function onboardingUserLabel(item: CompanyUserOnboarding): string {
  const name = item.display_name?.trim() ?? "";
  if (name && item.email) return `${name} <${item.email}>`;
  return item.email || item.user_id || item.invitation_id || "User";
}

function onboardingStatusLabels(item: CompanyUserOnboarding): string[] {
  const labels: string[] = [];
  if (item.invitation_status === "pending") labels.push("Invited");
  if (item.cognito_status === "created" || item.cognito_status === "resent" || item.cognito_status === "existing_mango_user") {
    labels.push("Cognito user created");
  } else if (item.cognito_status === "failed") {
    labels.push("Cognito failed");
  }
  if (item.invite_email_status === "sent") labels.push("Invite email sent");
  else if (item.invite_email_status === "failed") labels.push("Invite email failed");
  else if (item.invite_email_status === "not_configured") labels.push("Invite email not configured");
  if (item.invite_accepted || item.invitation_status === "accepted") labels.push("Invite accepted");
  if (item.google_connection_status === "connected") labels.push("Google connected");
  else if (item.google_connection_status === "reauth_required") labels.push("Google connection invalid / expired");
  else if (item.google_connection_status === "configuration_required") labels.push("Google/Gmail configuration required");
  else if (item.google_connection_status !== "disabled") labels.push("Google not connected");
  return labels;
}
