type TokenSet = {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_at: number;
};

export type CognitoConfig = {
  enabled: boolean;
  region: string;
  userPoolID: string;
  clientID: string;
  apiBase: string;
};

export type LoginResult =
  | { status: "authenticated" }
  | { status: "new_password_required"; username: string; session: string };

export type MangoMembership = {
  company_id: string;
  company_name?: string;
  user_id: string;
  role: "dev_admin" | "company_admin" | "company_user";
  created_timestamp: string;
  updated_timestamp: string;
};

export type MangoUser = {
  user_id: string;
  cognito_subject: string;
  email: string;
  display_name: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type MangoInvitation = {
  invitation_id: string;
  company_id: string;
  company_name?: string;
  email: string;
  role: "company_admin" | "company_user";
  status: string;
  cognito_status?: string;
  invite_email_status?: string;
  expires_timestamp: string;
};

export type CurrentUserResponse = {
  user: MangoUser;
  memberships: MangoMembership[];
  is_dev_admin: boolean;
};

const TOKEN_KEY = "mangorts:cognito-token-v2";
const COGNITO_PASSWORD_RESET_SECONDS = 60 * 60;
const PUBLIC_AUTH_PATHS = new Set(["/v1/invitations/validate", "/v1/invitations/accept", "/v1/password-resets/request"]);
const CURRENT_USER_CACHE_TTL_MS = 30_000;

let currentUserCache: { value: CurrentUserResponse; fetchedAt: number } | null = null;
let currentUserInflight: Promise<CurrentUserResponse> | null = null;
let currentUserCacheGeneration = 0;

export function readAuthConfig(): CognitoConfig {
  const env = import.meta.env ?? {};
  const browserOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const mode = (env.VITE_AUTH_MODE as string | undefined)?.trim().toLowerCase();
  const region = (env.VITE_COGNITO_REGION as string | undefined)?.trim() || (env.VITE_AWS_REGION as string | undefined)?.trim() || "";
  const userPoolID = (env.VITE_COGNITO_USER_POOL_ID as string | undefined)?.trim() ?? "";
  const clientID = (env.VITE_COGNITO_CLIENT_ID as string | undefined)?.trim() ?? "";
  const apiBase = (env.VITE_API_BASE_URL as string | undefined)?.trim() || browserOrigin;
  return {
    enabled: mode === "cognito",
    region,
    userPoolID,
    clientID,
    apiBase,
  };
}

export function isAuthEnabled(): boolean {
  return readAuthConfig().enabled;
}

export function hasStoredToken(): boolean {
  return readToken() !== null;
}

export function formatAuthError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return `${fallback}: ${error.message.trim()}`;
  }
  return fallback;
}

export async function loginWithPassword(email: string, password: string): Promise<LoginResult> {
  const config = readAuthConfig();
  assertConfigured(config);
  const username = normalizeEmail(email);
  const response = await cognitoRequest<InitiateAuthResponse>(config, "InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: config.clientID,
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password,
    },
  });
  if (response.AuthenticationResult) {
    writeAuthResult(response.AuthenticationResult);
    return { status: "authenticated" };
  }
  if (response.ChallengeName === "NEW_PASSWORD_REQUIRED" && response.Session) {
    return { status: "new_password_required", username, session: response.Session };
  }
  throw new Error("unsupported_cognito_challenge");
}

export async function completeNewPassword(username: string, session: string, newPassword: string): Promise<void> {
  const config = readAuthConfig();
  assertConfigured(config);
  const response = await cognitoRequest<ChallengeResponse>(config, "RespondToAuthChallenge", {
    ChallengeName: "NEW_PASSWORD_REQUIRED",
    ClientId: config.clientID,
    Session: session,
    ChallengeResponses: {
      USERNAME: normalizeEmail(username),
      NEW_PASSWORD: newPassword,
    },
  });
  if (!response.AuthenticationResult) {
    throw new Error("new_password_challenge_failed");
  }
  writeAuthResult(response.AuthenticationResult);
}

export async function forgotPassword(email: string): Promise<{ expires_in_seconds?: number }> {
  const username = normalizeEmail(email);
  const eligibility = await apiFetchJSON<{ expires_in_seconds?: number }>("/v1/password-resets/request", {
    method: "POST",
    body: JSON.stringify({ email: username }),
  });
  const config = readAuthConfig();
  assertConfigured(config);
  await cognitoRequest<unknown>(config, "ForgotPassword", {
    ClientId: config.clientID,
    Username: username,
  });
  return { expires_in_seconds: eligibility.expires_in_seconds ?? COGNITO_PASSWORD_RESET_SECONDS };
}

export async function resetPassword(email: string, confirmationCode: string, newPassword: string): Promise<void> {
  const config = readAuthConfig();
  assertConfigured(config);
  await cognitoRequest<unknown>(config, "ConfirmForgotPassword", {
    ClientId: config.clientID,
    Username: normalizeEmail(email),
    ConfirmationCode: confirmationCode.trim(),
    Password: newPassword,
  });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const config = readAuthConfig();
  assertConfigured(config);
  const accessToken = await getCognitoAccessToken(config);
  if (!accessToken) {
    throw new Error("Your session expired. Sign in again before changing your password.");
  }
  await cognitoRequest<unknown>(config, "ChangePassword", {
    AccessToken: accessToken,
    PreviousPassword: currentPassword,
    ProposedPassword: newPassword,
  });
}

export async function validateInvitationToken(token: string): Promise<MangoInvitation> {
  const payload = await apiFetchJSON<{ invitation: MangoInvitation }>("/v1/invitations/validate", {
    method: "POST",
    body: JSON.stringify({ token: token.trim() }),
  });
  return payload.invitation;
}

export async function acceptInvitation(token: string, displayName: string, email: string, password: string): Promise<void> {
  await apiFetchJSON("/v1/invitations/accept", {
    method: "POST",
    body: JSON.stringify({ token: token.trim(), display_name: displayName.trim(), email: normalizeEmail(email), password }),
  });
}

export async function fetchCurrentUser(): Promise<CurrentUserResponse> {
  if (currentUserCache && Date.now() - currentUserCache.fetchedAt <= CURRENT_USER_CACHE_TTL_MS) {
    return cloneCurrentUserResponse(currentUserCache.value);
  }
  if (currentUserInflight) return cloneCurrentUserResponse(await currentUserInflight);

  const generation = currentUserCacheGeneration;
  currentUserInflight = apiFetchJSON<CurrentUserResponse>("/v1/me")
    .then((current) => {
      const value = cloneCurrentUserResponse(current);
      if (generation === currentUserCacheGeneration) {
        currentUserCache = { value, fetchedAt: Date.now() };
      }
      return value;
    })
    .finally(() => {
      if (generation === currentUserCacheGeneration) currentUserInflight = null;
    });
  return cloneCurrentUserResponse(await currentUserInflight);
}

export function logout(): void {
  clearToken();
}

export function getAuthSessionCacheGeneration(): number {
  return currentUserCacheGeneration;
}

export function installAuthenticatedFetch(): void {
  const config = readAuthConfig();
  const installedFetch = window.fetch as typeof window.fetch & { __mangortsAuthInstalled?: boolean };
  if (!config.enabled || installedFetch.__mangortsAuthInstalled) return;

  const originalFetch = window.fetch.bind(window);
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = shouldAuthorizeRequest(config, input) ? await getAccessToken(config) : "";
    if (!token) {
      return originalFetch(input, init);
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("Authorization", `Bearer ${token}`);
    return originalFetch(input, { ...init, headers });
  };
  (wrapped as { __mangortsAuthInstalled?: boolean }).__mangortsAuthInstalled = true;
  window.fetch = wrapped;
}

export async function getApiAccessToken(): Promise<string> {
  const config = readAuthConfig();
  if (!config.enabled) return "";
  return getAccessToken(config);
}

export async function apiFetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const config = readAuthConfig();
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(apiRequestURL(config, path), { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(apiErrorMessage(response, text));
  }
  return response.json() as Promise<T>;
}

function apiRequestURL(config: CognitoConfig, path: string): string {
  if (shouldUseBrowserOriginForPublicAuth(path)) {
    return `${window.location.origin}${path}`;
  }
  return `${config.apiBase}${path}`;
}

type CognitoAuthResult = {
  AccessToken: string;
  IdToken?: string;
  RefreshToken?: string;
  ExpiresIn: number;
};

type InitiateAuthResponse = {
  AuthenticationResult?: CognitoAuthResult;
  ChallengeName?: string;
  Session?: string;
};

type ChallengeResponse = {
  AuthenticationResult?: CognitoAuthResult;
};

async function getAccessToken(config: CognitoConfig): Promise<string> {
  const token = await getFreshTokenSet(config);
  return token?.id_token || token?.access_token || "";
}

async function getCognitoAccessToken(config: CognitoConfig): Promise<string> {
  const token = await getFreshTokenSet(config);
  return token?.access_token || "";
}

async function getFreshTokenSet(config: CognitoConfig): Promise<TokenSet | null> {
  const token = readToken();
  if (!token) return null;
  if (Date.now() < token.expires_at - 30_000) {
    return token;
  }
  if (!token.refresh_token) {
    clearToken();
    return null;
  }
  try {
    const response = await cognitoRequest<InitiateAuthResponse>(config, "InitiateAuth", {
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: config.clientID,
      AuthParameters: {
        REFRESH_TOKEN: token.refresh_token,
      },
    });
    if (!response.AuthenticationResult) {
      clearToken();
      return null;
    }
    writeAuthResult({
      ...response.AuthenticationResult,
      RefreshToken: response.AuthenticationResult.RefreshToken ?? token.refresh_token,
    });
    return readToken();
  } catch {
    clearToken();
    return null;
  }
}

async function cognitoRequest<T>(config: CognitoConfig, action: string, payload: unknown): Promise<T> {
  const response = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(cognitoErrorMessage(response, text, action));
  }
  return response.json() as Promise<T>;
}

function cognitoErrorMessage(response: Response, text: string, action: string): string {
  const payload = parseErrorPayload(text);
  const type = normalizeAwsErrorType(stringValue(payload?.__type) || response.headers.get("x-amzn-errortype") || "");
  const rawMessage = stringValue(payload?.message) || stringValue(payload?.Message) || response.headers.get("x-amzn-errormessage")?.trim() || "";
  const message = friendlyCognitoError(type, rawMessage, action);
  if (message) return message;
  if (type && rawMessage) return `${type}: ${rawMessage}`;
  if (rawMessage) return rawMessage;
  if (type) return type;
  return `Cognito ${action} failed with HTTP ${response.status}.`;
}

function apiErrorMessage(response: Response, text: string): string {
  const payload = parseErrorPayload(text);
  const code = stringValue(payload?.error);
  const rawMessage = stringValue(payload?.message);
  const message = friendlyApiError(code);
  if (message) return message;
  if (rawMessage) return rawMessage;
  if (code) return code;
  if (text.trim()) return text.trim();
  return `API request failed with HTTP ${response.status}.`;
}

function friendlyCognitoError(type: string, message: string, action: string): string {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes("invalid session for the user") && lowerMessage.includes("used once")) {
    return "That Cognito invite session has already been used. Sign in with the new password, then paste the Mango invite token again.";
  }
  if (action === "ChangePassword" && type === "NotAuthorizedException" && lowerMessage.includes("incorrect")) {
    return "Current password is incorrect.";
  }
  if (type === "NotAuthorizedException" && lowerMessage.includes("incorrect username or password")) {
    return "Incorrect email or password.";
  }
  if (type === "NotAuthorizedException" && message) {
    return message;
  }
  if (type === "UserNotFoundException") {
    return "No Cognito user exists for that email. Ask an admin to resend the invite.";
  }
  if (type === "CodeMismatchException") {
    return "The reset code is not valid.";
  }
  if (type === "ExpiredCodeException") {
    return "The reset code has expired. Request a new reset code.";
  }
  if (type === "InvalidPasswordException" && message) {
    return message;
  }
  if (type === "PasswordResetRequiredException") {
    return "This account requires a password reset before signing in.";
  }
  if (type === "TooManyRequestsException") {
    return "Too many attempts. Wait a bit, then try again.";
  }
  return "";
}

function friendlyApiError(code: string): string {
  switch (code) {
    case "failed_to_create_cognito_user":
      return "Mango created the invite, but Cognito did not create the user. Check backend logs, AWS credentials, and onboarding status, then resend.";
    case "failed_to_set_cognito_password":
      return "Mango could not set the invited user's password. Check backend logs, AWS credentials, and Cognito password policy.";
    case "cognito_admin_not_configured":
      return "Invite acceptance is not configured for Cognito in this environment.";
    case "failed_to_list_company_users":
      return "Company users could not be loaded. Run pending database migrations, then refresh.";
    case "failed_to_list_onboarding":
      return "User onboarding status could not be loaded.";
    case "failed_to_list_user_groups":
    case "failed_to_list_user_group_members":
      return "User groups could not be loaded. Run pending database migrations, then refresh.";
    case "invitation_email_mismatch":
      return "This Mango invite token belongs to a different email address.";
    case "password_required":
      return "Enter a new password.";
    case "invitation_token_required":
      return "Enter the Mango invite token.";
    case "invitation_bad_token":
      return "The Mango invite token is not valid.";
    case "invitation_expired":
      return "The Mango invite token has expired. Ask an admin to send a new invite.";
    case "invitation_already_accepted":
      return "This Mango invite token was already accepted. Sign in instead.";
    case "invitation_replaced":
      return "This Mango invite token was replaced by a newer invite. Use the newest invite email.";
    case "invitation_not_found":
      return "The Mango invite token is not valid.";
    case "unauthorized":
      return "You are not signed in.";
    case "authenticated_email_required":
      return "The signed-in Cognito session does not include an email address.";
    case "company_admin_required":
      return "You need company admin access for that company.";
    case "dev_admin_required":
      return "You need dev admin access.";
    case "invalid_invitation":
      return "The invite email, company, or role is invalid.";
    case "company_not_found":
      return "The selected company was not found.";
    case "user_already_exists":
      return "This user already exists.";
    case "display_name_required":
      return "Enter your full name.";
    case "password_reset_user_not_found":
      return "You are not a user.";
    case "nylas_rate_limited":
      return "Nylas is rate limiting this mailbox. Wait a moment, then refresh.";
    case "nylas_request_failed":
      return "Nylas could not load this mailbox right now. Wait a moment, then refresh.";
    case "nylas_request_rejected":
      return "Nylas rejected the mailbox request. Reconnect email if this keeps happening.";
    case "nylas_reauth_required":
      return "Email access expired. Disconnect and reconnect your mailbox.";
    case "nylas_not_connected":
      return "Connect your mailbox before opening Home.";
    case "nylas_not_configured":
      return "Google connection is not configured for this environment.";
    case "failed_to_list_shared_inboxes":
      return "Shared Triage folders could not be loaded.";
    case "failed_to_create_shared_inbox":
      return "Shared Triage folder could not be created.";
    case "failed_to_update_shared_inbox_access":
      return "Shared Triage access could not be updated.";
    case "shared_inbox_storage_unavailable":
      return "Shared Triage storage is not ready. Run pending database migrations, then try again.";
    case "failed_to_delete_cognito_user":
      return "The user could not be deleted in Cognito. Try again shortly.";
    case "failed_to_delete_company_user":
      return "The user could not be deleted from Mango. Try again shortly.";
    case "company_user_not_found":
      return "That user was not found in this company.";
    case "cannot_delete_self":
      return "You cannot delete your own signed-in account.";
    default:
      return "";
  }
}

function parseErrorPayload(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeAwsErrorType(type: string): string {
  const trimmed = type.trim();
  if (!trimmed) return "";
  const withoutNamespace = trimmed.includes("#") ? trimmed.slice(trimmed.lastIndexOf("#") + 1) : trimmed;
  const withoutPackage = withoutNamespace.includes(".") ? withoutNamespace.slice(withoutNamespace.lastIndexOf(".") + 1) : withoutNamespace;
  return withoutPackage.replace(/:+$/, "");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function shouldUseBrowserOriginForPublicAuth(path: string): boolean {
  return typeof window !== "undefined" && PUBLIC_AUTH_PATHS.has(path);
}

function shouldAuthorizeRequest(config: CognitoConfig, input: RequestInfo | URL): boolean {
  const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
  const url = new URL(raw, window.location.origin);
  if (url.origin === window.location.origin && isApiRequestPath(url.pathname)) {
    return true;
  }
  const apiBase = new URL(config.apiBase, window.location.origin);
  return url.origin === apiBase.origin && isApiRequestPath(url.pathname);
}

function isApiRequestPath(pathname: string): boolean {
  return pathname.startsWith("/v1/") || pathname.startsWith("/v2/") || pathname === "/healthz";
}

function writeAuthResult(result: CognitoAuthResult): void {
  clearCurrentUserCache();
  const token: TokenSet = {
    access_token: result.AccessToken,
    id_token: result.IdToken,
    refresh_token: result.RefreshToken,
    expires_at: Date.now() + result.ExpiresIn * 1000,
  };
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

function readToken(): TokenSet | null {
  const raw = sessionStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TokenSet;
    return parsed.access_token && parsed.expires_at ? parsed : null;
  } catch {
    return null;
  }
}

function clearToken(): void {
  clearCurrentUserCache();
  sessionStorage.removeItem(TOKEN_KEY);
}

function clearCurrentUserCache(): void {
  currentUserCacheGeneration += 1;
  currentUserCache = null;
  currentUserInflight = null;
}

function cloneCurrentUserResponse(current: CurrentUserResponse): CurrentUserResponse {
  return {
    ...current,
    user: { ...current.user },
    memberships: current.memberships.map((membership) => ({ ...membership })),
  };
}

function assertConfigured(config: CognitoConfig): void {
  if (!config.region || !config.userPoolID || !config.clientID) {
    throw new Error("cognito_auth_not_configured");
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
