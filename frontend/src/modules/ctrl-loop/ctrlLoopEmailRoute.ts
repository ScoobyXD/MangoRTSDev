export type CtrlLoopEmailTarget = { companyID: string; emailThreadID: string; emailMessageID: string };

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const sourcePath = new RegExp(`^/ctrl-loop/email/(${uuid})/(${uuid})/(${uuid})$`);

// These are the durable source identities, never provider IDs or the active company.
export function parseCtrlLoopEmailRoute(pathname: string): CtrlLoopEmailTarget | null {
  const match = sourcePath.exec(pathname);
  return match ? { companyID: match[1], emailThreadID: match[2], emailMessageID: match[3] } : null;
}

export function ctrlLoopEmailTargetFromLink(href: string, origin: string): CtrlLoopEmailTarget | null {
  try {
    const url = new URL(href);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash) return null;
    return parseCtrlLoopEmailRoute(url.pathname);
  } catch {
    return null;
  }
}
