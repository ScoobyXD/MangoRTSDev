import React from "react";
import { workbookWebLink } from "../../modules/ctrl-loop/ctrlLoopApi.js";
import { ctrlLoopEmailTargetFromLink, type CtrlLoopEmailTarget } from "../../modules/ctrl-loop/ctrlLoopEmailRoute.js";

export const LazyCtrlLoopEmailPreview = React.lazy(() => import("./CtrlLoopEmailPreview.js").then((module) => ({ default: module.CtrlLoopEmailPreview })));

export function CtrlLoopEmailLink({ href, title, children, onOpenEmail }: { href?: string; title?: string; children: React.ReactNode; onOpenEmail: (target: CtrlLoopEmailTarget) => void }) {
  const safeHref = workbookWebLink(href);
  if (!safeHref) return <>{children}</>;
  return <a href={safeHref} title={title} target="_blank" rel="noopener noreferrer" onClick={(event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = ctrlLoopEmailTargetFromLink(safeHref, window.location.origin);
    if (target) { event.preventDefault(); onOpenEmail(target); }
  }}>{children}</a>;
}
