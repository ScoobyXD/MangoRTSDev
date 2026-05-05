type TokenSet = {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_at: number;
};

type CognitoConfig = {
  enabled: boolean;
  domain: string;
  clientID: string;
  redirectURI: string;
  logoutURI: string;
  scopes: string;
  apiBase: string;
};

const TOKEN_KEY = "mangorts:cognito-token-v1";
const PKCE_VERIFIER_KEY = "mangorts:cognito-pkce-verifier-v1";
const OAUTH_STATE_KEY = "mangorts:cognito-oauth-state-v1";

export async function bootstrapAuth(): Promise<void> {
  const config = readConfig();
  if (!config.enabled) return;

  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (code) {
    await completeLogin(config, code, state ?? "");
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    window.history.replaceState({}, document.title, url.toString());
  }

  const token = await getAccessToken(config);
  if (!token) {
    await beginLogin(config);
  }
}

export function installAuthenticatedFetch(): void {
  const config = readConfig();
  if (!config.enabled) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = shouldAuthorizeRequest(config, input) ? await getAccessToken(config) : "";
    if (!token) {
      return originalFetch(input, init);
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("Authorization", `Bearer ${token}`);
    return originalFetch(input, { ...init, headers });
  };
}

export async function getApiAccessToken(): Promise<string> {
  const config = readConfig();
  if (!config.enabled) return "";
  return getAccessToken(config);
}

function readConfig(): CognitoConfig {
  const env = import.meta.env ?? {};
  const browserOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const mode = (env.VITE_AUTH_MODE as string | undefined)?.trim().toLowerCase();
  const domain = normalizeDomain(env.VITE_COGNITO_DOMAIN as string | undefined);
  const clientID = (env.VITE_COGNITO_CLIENT_ID as string | undefined)?.trim() ?? "";
  const redirectURI = (env.VITE_COGNITO_REDIRECT_URI as string | undefined)?.trim() || browserOrigin;
  const logoutURI = (env.VITE_COGNITO_LOGOUT_URI as string | undefined)?.trim() || browserOrigin;
  const scopes = (env.VITE_COGNITO_SCOPES as string | undefined)?.trim() || "openid email profile";
  const apiBase = (env.VITE_API_BASE_URL as string | undefined)?.trim() || browserOrigin;
  return {
    enabled: mode === "cognito",
    domain,
    clientID,
    redirectURI,
    logoutURI,
    scopes,
    apiBase,
  };
}

async function getAccessToken(config: CognitoConfig): Promise<string> {
  const token = readToken();
  if (!token) return "";
  if (Date.now() < token.expires_at - 30_000) {
    return token.access_token;
  }
  if (!token.refresh_token) return "";
  try {
    const refreshed = await exchangeToken(config, {
      grant_type: "refresh_token",
      client_id: config.clientID,
      refresh_token: token.refresh_token,
    });
    const next = {
      ...refreshed,
      refresh_token: refreshed.refresh_token ?? token.refresh_token,
    };
    writeToken(next);
    return next.access_token;
  } catch {
    clearToken();
    return "";
  }
}

async function beginLogin(config: CognitoConfig): Promise<never> {
  assertConfigured(config);
  const verifier = randomString(64);
  const challenge = await pkceChallenge(verifier);
  const state = randomString(32);
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(OAUTH_STATE_KEY, state);

  const authorize = new URL(`${config.domain}/oauth2/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", config.clientID);
  authorize.searchParams.set("redirect_uri", config.redirectURI);
  authorize.searchParams.set("scope", config.scopes);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("code_challenge", challenge);
  window.location.assign(authorize.toString());
  return new Promise<never>(() => undefined);
}

async function completeLogin(config: CognitoConfig, code: string, state: string): Promise<void> {
  assertConfigured(config);
  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY) ?? "";
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY) ?? "";
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  if (!expectedState || state !== expectedState || !verifier) {
    clearToken();
    throw new Error("invalid_cognito_login_state");
  }

  const token = await exchangeToken(config, {
    grant_type: "authorization_code",
    client_id: config.clientID,
    code,
    redirect_uri: config.redirectURI,
    code_verifier: verifier,
  });
  writeToken(token);
}

async function exchangeToken(config: CognitoConfig, params: Record<string, string>): Promise<TokenSet> {
  const body = new URLSearchParams(params);
  const response = await fetch(`${config.domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`cognito_token_${response.status}`);
  }
  const payload = (await response.json()) as {
    access_token: string;
    id_token?: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    access_token: payload.access_token,
    id_token: payload.id_token,
    refresh_token: payload.refresh_token,
    expires_at: Date.now() + payload.expires_in * 1000,
  };
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

function readToken(): TokenSet | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TokenSet;
    return parsed.access_token && parsed.expires_at ? parsed : null;
  } catch {
    return null;
  }
}

function writeToken(token: TokenSet): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function normalizeDomain(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  return trimmed.startsWith("https://") ? trimmed.replace(/\/$/, "") : `https://${trimmed.replace(/\/$/, "")}`;
}

function assertConfigured(config: CognitoConfig): void {
  if (!config.domain || !config.clientID) {
    throw new Error("cognito_auth_not_configured");
  }
}

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64URL(bytes).slice(0, length);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64URL(new Uint8Array(digest));
}

function base64URL(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
