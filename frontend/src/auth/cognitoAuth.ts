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
  created_timestamp: string;
  updated_timestamp: string;
};

export type CurrentUserResponse = {
  user: MangoUser;
  memberships: MangoMembership[];
  is_dev_admin: boolean;
};

const TOKEN_KEY = "mangorts:cognito-token-v2";

export function bootstrapAuth(): Promise<void> {
  return Promise.resolve();
}

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

export async function forgotPassword(email: string): Promise<void> {
  const config = readAuthConfig();
  assertConfigured(config);
  await cognitoRequest<unknown>(config, "ForgotPassword", {
    ClientId: config.clientID,
    Username: normalizeEmail(email),
  });
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

export async function acceptInvitation(token: string): Promise<void> {
  await apiFetchJSON("/v1/invitations/accept", {
    method: "POST",
    body: JSON.stringify({ token: token.trim() }),
  });
}

export async function fetchCurrentUser(): Promise<CurrentUserResponse> {
  return apiFetchJSON<CurrentUserResponse>("/v1/me");
}

export function logout(): void {
  clearToken();
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
  const response = await fetch(`${config.apiBase}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(apiErrorMessage(response, text));
  }
  return response.json() as Promise<T>;
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
  const token = readToken();
  if (!token) return "";
  if (Date.now() < token.expires_at - 30_000) {
    return token.id_token || token.access_token;
  }
  if (!token.refresh_token) {
    clearToken();
    return "";
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
      return "";
    }
    writeAuthResult({
      ...response.AuthenticationResult,
      RefreshToken: response.AuthenticationResult.RefreshToken ?? token.refresh_token,
    });
    const next = readToken();
    return next?.id_token || next?.access_token || "";
  } catch {
    clearToken();
    return "";
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
  const message = friendlyCognitoError(type, rawMessage);
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

function friendlyCognitoError(type: string, message: string): string {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes("invalid session for the user") && lowerMessage.includes("used once")) {
    return "That Cognito invite session has already been used. Sign in with the new password, then paste the Mango invite token again.";
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
      return "Mango created the invite, but Cognito did not create the user. Check backend logs and AWS credentials, then create a fresh invite.";
    case "invitation_email_mismatch":
      return "This Mango invite token belongs to a different email address.";
    case "invitation_not_found":
      return "This Mango invite token was not found, has expired, was already accepted, or was replaced by a newer invite.";
    case "unauthorized":
      return "You are not signed in. Sign in or complete the temporary password step first.";
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

function shouldAuthorizeRequest(config: CognitoConfig, input: RequestInfo | URL): boolean {
  const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
  const url = new URL(raw, window.location.origin);
  if (url.origin === window.location.origin && (url.pathname.startsWith("/v1/") || url.pathname === "/healthz")) {
    return true;
  }
  const apiBase = new URL(config.apiBase, window.location.origin);
  return url.origin === apiBase.origin && (url.pathname.startsWith("/v1/") || url.pathname === "/healthz");
}

function writeAuthResult(result: CognitoAuthResult): void {
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
  sessionStorage.removeItem(TOKEN_KEY);
}

function assertConfigured(config: CognitoConfig): void {
  if (!config.region || !config.userPoolID || !config.clientID) {
    throw new Error("cognito_auth_not_configured");
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
