import { normalizeAppPath, parseDeepLinkRoute } from "../app/deepLinkRoutes.js";
import { parseCtrlLoopEmailRoute } from "../modules/ctrl-loop/ctrlLoopEmailRoute.js";

export const AUTH_PATHS = new Set(["/login", "/accept-invite", "/complete-account", "/forgot-password", "/reset-password"]);

const AUTH_RETURN_STATIC_PATHS = new Set([
  "/", "/home", "/communication", "/communications", "/logic-gate-arena", "/my-work",
  "/project-management", "/account-manager", "/teams", "/ctrl-loop", "/entities", "/settings",
  "/admin/users", "/recycle-bin", "/connect-google",
]);

export function canUseAuthReturnPath(pathname: string): boolean {
  const path = normalizeAppPath(pathname);
  return AUTH_RETURN_STATIC_PATHS.has(path) || parseDeepLinkRoute(path) !== null || parseCtrlLoopEmailRoute(path) !== null;
}

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
  if (authenticated && (path === "/login" || path === "/complete-account")) return "/my-work";
  return path;
}

export function nextPathAfterAuthentication(pathname: string, returnPath?: string): string {
  const cleanReturnPath = normalizeReturnPath(returnPath ?? "");
  if (cleanReturnPath) return nextPathForAuthState(cleanReturnPath, true);
  return nextPathForAuthState(pathname, true);
}

function normalizePath(pathname: string): string {
  const path = (pathname.trim() || "/").split(/[?#]/, 1)[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function normalizeReturnPath(pathname: string): string {
  if (!pathname.trim()) return "";
  const path = normalizePath(pathname);
  if (isAuthPath(path)) return "";
  return path;
}

