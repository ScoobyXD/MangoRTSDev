import React, { useCallback, useEffect, useMemo, useState } from "react";
import AppLayout from "../app/applayout";
import { getActiveCompanyID, setActiveCompanyID } from "./currentCompany";
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
import { CommunicationsPage } from "../pages/communications/CommunicationsPage";

type PendingChallenge = Extract<LoginResult, { status: "new_password_required" }> | null;

type CompanyUser = {
  company_id: string;
  user_id: string;
  email: string;
  display_name?: string;
  role: string;
};

const PASSWORD_RESET_SECONDS = 60 * 60;

type Company = {
  company_id: string;
  name: string;
};

type CompanyOption = Company & {
  role?: string;
};

const panelStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "#f7fffe",
  color: "#041d22",
  fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace",
};

const formStyle: React.CSSProperties = {
  width: "min(420px, calc(100vw - 32px))",
  display: "grid",
  gap: 12,
  padding: 18,
  border: "1px solid rgba(12, 67, 74, 0.35)",
  background: "#ffffff",
  borderRadius: 8,
  boxShadow: "0 12px 34px rgba(4, 29, 34, 0.12)",
};

const inputStyle: React.CSSProperties = {
  height: 38,
  border: "1px solid rgba(12, 67, 74, 0.35)",
  borderRadius: 6,
  padding: "0 10px",
  font: "inherit",
};

const buttonStyle: React.CSSProperties = {
  height: 38,
  border: "1px solid #07545d",
  borderRadius: 6,
  background: "#00e9ff",
  color: "#041d22",
  cursor: "pointer",
  fontWeight: 800,
};

export default function AuthGate() {
  const authEnabled = isAuthEnabled();
  const [path, setPath] = useState(() => window.location.pathname);
  const [me, setMe] = useState<CurrentUserResponse | null>(null);
  const [loading, setLoading] = useState(authEnabled && hasStoredToken());
  const [error, setError] = useState("");
  const [pendingChallenge, setPendingChallenge] = useState<PendingChallenge>(null);

  const navigate = useCallback((nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }, []);

  const loadMe = useCallback(async () => {
    if (!authEnabled) return;
    setLoading(true);
    setError("");
    try {
      const current = await fetchCurrentUser();
      setMe(current);
      const companyID = current.memberships.find((item) => item.role !== "dev_admin")?.company_id ?? current.memberships[0]?.company_id;
      if (companyID) setActiveCompanyID(companyID);
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

  if (!authEnabled) return <AppLayout />;
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
    return <SettingsPage me={me} onNavigate={navigate} onLogout={() => logoutAndNavigate(navigate)} />;
  }

  if (normalizedPath === "/communications") {
    return <CommunicationsPage me={me} onNavigate={navigate} onLogout={() => logoutAndNavigate(navigate)} />;
  }

  return (
    <>
      <AppLayout />
      <AccountBar me={me} onNavigate={navigate} onLogout={() => logoutAndNavigate(navigate)} />
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
          onNavigate("/");
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
          <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800 }}>
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

function SettingsPage({ me, onNavigate, onLogout }: { me: CurrentUserResponse; onNavigate: (path: string) => void; onLogout: () => void }) {
  const membershipOptions = useMemo<CompanyOption[]>(
    () => me.memberships.map((item) => ({ company_id: item.company_id, name: item.company_name || "Company", role: item.role })),
    [me],
  );
  const [createdCompanies, setCreatedCompanies] = useState<Company[]>([]);
  const companyOptions = useMemo<CompanyOption[]>(() => {
    return [...createdCompanies, ...membershipOptions.filter((item) => !createdCompanies.some((company) => company.company_id === item.company_id))];
  }, [createdCompanies, membershipOptions]);
  const [companyID, setCompanyID] = useState(companyOptions[0]?.company_id ?? getActiveCompanyID());
  const selectedCompany = companyOptions.find((company) => company.company_id === companyID) ?? null;
  const canManageSelectedCompany = Boolean(companyID) && (me.is_dev_admin || selectedCompany?.role === "company_admin");
  const [users, setUsers] = useState<CompanyUser[]>([]);
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
  const activeCompanyLabel = selectedCompany ? companyName(selectedCompany) : companyID ? "Manual company" : "No company selected";

  const load = useCallback(async () => {
    if (!companyID || !canManageSelectedCompany) {
      setUsers([]);
      return;
    }
    setError("");
    try {
      const usersPayload = await apiFetchJSON<{ users: CompanyUser[] }>(`/v1/companies/${encodeURIComponent(companyID)}/users`);
      setUsers(usersPayload.users ?? []);
    } catch {
      setError("Failed to load users");
    }
  }, [canManageSelectedCompany, companyID]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (companyID) setActiveCompanyID(companyID); }, [companyID]);

  return (
    <div style={{ minHeight: "100vh", background: "#f7fffe", color: "#041d22", fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace", padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Settings</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={smallButtonStyle} onClick={() => onNavigate("/")}>App</button>
          <button style={smallButtonStyle} onClick={() => onNavigate("/communications")}>Communications</button>
          <button style={smallButtonStyle} onClick={onLogout}>Logout</button>
        </div>
      </div>
      {error && <div style={{ color: "#9c1b1b", marginBottom: 10 }}>{error}</div>}
      <div style={settingsTopRowStyle}>
        <section style={{ ...sectionStyle, flex: "1 1 280px" }}>
          <h2 style={sectionTitleStyle}>Company</h2>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{activeCompanyLabel}</div>
            {companyID && <div style={{ fontSize: 11, overflowWrap: "anywhere" }}>UUID: {companyID}</div>}
          </div>
          {(companyOptions.length > 1 || me.is_dev_admin) && (
            <select style={inputStyle} value={selectedCompany?.company_id ?? ""} onChange={(event) => setCompanyID(event.target.value)}>
              {me.is_dev_admin && <option value="">Manual company UUID</option>}
              {companyOptions.map((company) => <option key={company.company_id} value={company.company_id}>{companyName(company)}</option>)}
            </select>
          )}
          {me.is_dev_admin && (
            <input
              style={inputStyle}
              value={companyID}
              onChange={(event) => setCompanyID(event.target.value.trim())}
              placeholder="Target company UUID"
              autoComplete="off"
            />
          )}
          {me.is_dev_admin && (
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
                setCreatedCompanyNotice(company);
                setNewCompanyName("");
              } catch (companyError) {
                console.error("Company creation failed", companyError);
                setError(formatAuthError(companyError, "Company creation failed"));
              } finally {
                setCompanyBusy(false);
              }
            }}>
              <input style={inputStyle} value={newCompanyName} onChange={(event) => setNewCompanyName(event.target.value)} placeholder="New company name" />
              <button style={buttonStyle} disabled={companyBusy}>{companyBusy ? "Creating" : "Create company"}</button>
            </form>
          )}
          {createdCompanyNotice && (
            <div style={successBoxStyle}>
              <span>Company created: {createdCompanyNotice.name}</span>
              <span style={{ overflowWrap: "anywhere" }}>UUID: {createdCompanyNotice.company_id}</span>
            </div>
          )}
        </section>
        {canManageSelectedCompany && <section style={{ ...sectionStyle, flex: "1 1 280px" }}>
          <h2 style={sectionTitleStyle}>Invite</h2>
          <form style={{ display: "grid", gap: 8 }} onSubmit={async (event) => {
            event.preventDefault();
            const normalizedInviteEmail = normalizeEmailInput(inviteEmail);
            setError("");
            setInviteMessage("");
            setInviteToken("");
            if (!normalizedInviteEmail) {
              setError("Email required");
              return;
            }
            if (!companyID) {
              setError("Company UUID required");
              return;
            }
            try {
              const payload = await apiFetchJSON<{ invitation: { token?: string }; cognito_invite_status?: string }>("/v1/invitations", {
                method: "POST",
                body: JSON.stringify({ company_id: companyID, email: normalizedInviteEmail, role: inviteRole }),
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
            <input style={inputStyle} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value.toLowerCase())} type="email" placeholder="Email" />
            <select style={inputStyle} value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
              <option value="company_user">company_user</option>
              <option value="company_admin">company_admin</option>
            </select>
            <button style={buttonStyle}>Invite user</button>
          </form>
          {inviteToken && <div style={{ overflowWrap: "anywhere", fontSize: 12 }}>Invite token: {inviteToken}</div>}
          {inviteMessage && <div style={{ fontSize: 12 }}>{inviteMessage}</div>}
        </section>}
        <section style={{ ...sectionStyle, flex: me.is_dev_admin ? "0 1 360px" : "1 1 280px", marginLeft: me.is_dev_admin ? "auto" : undefined }}>
          <h2 style={sectionTitleStyle}>User Profile</h2>
          <div style={profileGridStyle}>
            <span style={profileLabelStyle}>Name</span>
            <span style={profileValueStyle}>{me.user.display_name || "No name set"}</span>
            <span style={profileLabelStyle}>Email</span>
            <span style={profileValueStyle}>{me.user.email}</span>
            <span style={profileLabelStyle}>Role</span>
            <span style={profileValueStyle}>{selectedUserRole(me, selectedCompany)}</span>
          </div>
          <form style={{ display: "grid", gap: 8, borderTop: "1px solid rgba(12, 67, 74, 0.16)", paddingTop: 10 }} onSubmit={async (event) => {
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
            <input style={inputStyle} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type="password" placeholder="Current password" autoComplete="current-password" />
            <input style={inputStyle} value={newSettingsPassword} onChange={(event) => setNewSettingsPassword(event.target.value)} type="password" placeholder="New password" autoComplete="new-password" />
            <input style={inputStyle} value={confirmSettingsPassword} onChange={(event) => setConfirmSettingsPassword(event.target.value)} type="password" placeholder="Confirm new password" autoComplete="new-password" />
            <button style={buttonStyle} disabled={passwordBusy}>{passwordBusy ? "Changing" : "Change password"}</button>
          </form>
          {passwordError && <div style={{ color: "#9c1b1b", fontSize: 12 }}>{passwordError}</div>}
          {passwordMessage && <div style={successMessageStyle}>{passwordMessage}</div>}
        </section>
      </div>
      {canManageSelectedCompany && <section style={{ ...sectionStyle, marginTop: 14 }}>
        <h2 style={sectionTitleStyle}>Company Users</h2>
        <div style={{ display: "grid", gap: 6 }}>
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
      {deleteConfirmation && (
        <div style={modalBackdropStyle}>
          <div style={modalStyle}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#111111" }}>
              Are you sure you want to delete this user?
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.4, color: "#2e2e2e", overflowWrap: "anywhere" }}>
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
                style={{ ...smallButtonStyle, minHeight: 34, fontWeight: 800 }}
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
        <h1 style={{ margin: 0, fontSize: 22, textTransform: "uppercase" }}>{title}</h1>
        {error && <div style={{ color: "#9c1b1b", fontSize: 12 }}>{error}</div>}
        {children}
      </div>
    </div>
  );
}

function AccountBar({ me, onNavigate, onLogout }: { me: CurrentUserResponse; onNavigate: (path: string) => void; onLogout: () => void }) {
  return (
    <div style={{ position: "fixed", top: 8, right: 8, zIndex: 200, display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", background: "rgba(255,255,255,0.92)", border: "1px solid rgba(12, 67, 74, 0.28)", borderRadius: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
      <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me.user.email}</span>
      <button style={smallButtonStyle} onClick={() => onNavigate("/communications")}>Communications</button>
      <button style={smallButtonStyle} onClick={() => onNavigate("/settings")}>Settings</button>
      <button style={smallButtonStyle} onClick={onLogout}>Logout</button>
    </div>
  );
}

function logoutAndNavigate(navigate: (path: string) => void): void {
  logout();
  navigate("/login");
}

const linkButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#07545d",
  cursor: "pointer",
  font: "inherit",
  padding: 0,
};

const smallButtonStyle: React.CSSProperties = {
  minHeight: 28,
  border: "1px solid rgba(12, 67, 74, 0.35)",
  borderRadius: 6,
  background: "#fff",
  color: "#041d22",
  cursor: "pointer",
  font: "inherit",
  padding: "0 8px",
};

const sectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
  padding: 12,
  border: "1px solid rgba(12, 67, 74, 0.25)",
  background: "#fff",
  borderRadius: 8,
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
  textTransform: "uppercase",
};

const successMessageStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "#0f7b3f",
  fontSize: 13,
  fontWeight: 800,
};

const successBoxStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  color: "#0f7b3f",
  fontSize: 12,
  fontWeight: 800,
};

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  minHeight: 32,
  borderBottom: "1px solid rgba(12, 67, 74, 0.16)",
  fontSize: 12,
};

const userRowStyle: React.CSSProperties = {
  ...rowStyle,
  gridTemplateColumns: "minmax(0, 1fr) auto auto",
};

const dangerButtonStyle: React.CSSProperties = {
  borderColor: "#ff3d7f",
  color: "#8b123f",
};

const profileGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  gap: "6px 10px",
  fontSize: 12,
};

const profileLabelStyle: React.CSSProperties = {
  color: "rgba(4, 29, 34, 0.62)",
  fontWeight: 800,
  textTransform: "uppercase",
};

const profileValueStyle: React.CSSProperties = {
  minWidth: 0,
  overflowWrap: "anywhere",
};

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.28)",
  zIndex: 120,
  display: "grid",
  placeItems: "center",
  padding: 16,
};

const modalStyle: React.CSSProperties = {
  width: "min(420px, 100%)",
  borderRadius: 8,
  border: "1px solid rgba(0,233,255,0.45)",
  background: "rgba(255,255,255,0.96)",
  padding: 12,
  display: "grid",
  gap: 10,
};

function companyUserLabel(user: CompanyUser): string {
  const name = (user.display_name ?? "").trim();
  if (name && user.email) return `${name} <${user.email}>`;
  return name || user.email || user.user_id;
}
