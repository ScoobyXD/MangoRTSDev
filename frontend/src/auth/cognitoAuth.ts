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
  user_id: string;
  role: "dev_admin" | "company_admin" | "company_user" | "company_viewer";
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
    throw new Error(text || `api_${response.status}`);
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
    throw new Error(text || `cognito_${action}_${response.status}`);
  }
  return response.json() as Promise<T>;
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
