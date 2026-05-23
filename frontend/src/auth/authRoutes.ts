export const AUTH_PATHS = new Set(["/login", "/accept-invite", "/forgot-password", "/reset-password"]);

const LEGACY_AUTHENTICATED_PATHS = new Map([
  ["/admin/users", "/settings"],
  ["/communication", "/home"],
  ["/communications", "/home"],
]);

export function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.has(normalizePath(pathname));
}

export function nextPathForAuthState(pathname: string, authenticated: boolean): string {
  const path = normalizePath(pathname);
  if (!authenticated && !isAuthPath(path)) return "/login";
  if (authenticated && LEGACY_AUTHENTICATED_PATHS.has(path)) return LEGACY_AUTHENTICATED_PATHS.get(path) ?? path;
  if (authenticated && path === "/login") return "/home";
  return path;
}

function normalizePath(pathname: string): string {
  const path = pathname.trim() || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

