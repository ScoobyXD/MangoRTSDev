import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EditorSelectionNodeIcon,
  ExplorerDisclosureIcon,
  ExplorerEntityIcon,
  ExplorerRowIcon,
  HeaderAccountManagerIcon,
  HeaderExplorerIcon,
  HeaderHomeIcon,
  HeaderLogicGateArenaIcon,
  HeaderMapIcon,
  HeaderProjectManagementIcon,
  HeaderRecycleBinIcon,
  HeaderSettingsIcon,
  HeaderSharedTriageIcon,
  HeaderTeamsIcon,
  HeaderTriageIcon,
  HeaderUpdatesIcon,
  KanbanBoardIcon,
  MangoLogoMark,
  MangoWordmark,
} from "../src/icons/index.js";

type IconEntry = {
  name: string;
  group: string;
  element: React.ReactElement;
  note?: string;
};

const icons: IconEntry[] = [
  { name: "Mango logo mark", group: "Brand", element: <MangoLogoMark size={24} /> },
  { name: "MangoRTS wordmark", group: "Brand", element: <MangoWordmark size={18} /> },
  { name: "Home", group: "Navigation", element: <HeaderHomeIcon /> },
  { name: "Explorer", group: "Navigation", element: <HeaderExplorerIcon /> },
  { name: "Updates", group: "Navigation", element: <HeaderUpdatesIcon /> },
  { name: "Emails", group: "Navigation", element: <HeaderTriageIcon /> },
  { name: "Shared Emails", group: "Navigation", element: <HeaderSharedTriageIcon /> },
  { name: "Project Management", group: "Navigation", element: <HeaderProjectManagementIcon /> },
  { name: "Account Manager", group: "Navigation", element: <HeaderAccountManagerIcon /> },
  { name: "Teams", group: "Navigation", element: <HeaderTeamsIcon /> },
  { name: "Process Arena", group: "Navigation", element: <HeaderLogicGateArenaIcon /> },
  { name: "Map", group: "Navigation", element: <HeaderMapIcon /> },
  { name: "Settings", group: "Navigation", element: <HeaderSettingsIcon /> },
  { name: "Recycle Bin", group: "Navigation", element: <HeaderRecycleBinIcon /> },
  { name: "Node", group: "Entities", element: <ExplorerEntityIcon kind="node" /> },
  { name: "Process", group: "Entities", element: <ExplorerEntityIcon kind="logic_gate" /> },
  { name: "Project", group: "Entities", element: <ExplorerEntityIcon kind="project" /> },
  { name: "Entity", group: "Entities", element: <ExplorerEntityIcon kind="entity" /> },
  { name: "Node — inverse", group: "Entities", element: <ExplorerEntityIcon kind="node" tone="inverse" /> },
  { name: "Process — inverse", group: "Entities", element: <ExplorerEntityIcon kind="logic_gate" tone="inverse" /> },
  { name: "Project — inverse", group: "Entities", element: <ExplorerEntityIcon kind="project" tone="inverse" /> },
  { name: "Entity — inverse", group: "Entities", element: <ExplorerEntityIcon kind="entity" tone="inverse" /> },
  { name: "Node — orange", group: "Entities", element: <ExplorerEntityIcon kind="node" tone="orange" /> },
  { name: "Process — orange", group: "Entities", element: <ExplorerEntityIcon kind="logic_gate" tone="orange" /> },
  { name: "Project — orange", group: "Entities", element: <ExplorerEntityIcon kind="project" tone="orange" /> },
  { name: "Entity — orange", group: "Entities", element: <ExplorerEntityIcon kind="entity" tone="orange" /> },
  { name: "Standard folder", group: "Explorer", element: <ExplorerRowIcon kind="folder" /> },
  { name: "Mango system folder", group: "Explorer", element: <ExplorerRowIcon kind="folder" mangoDefaultFolder /> },
  { name: "Folder — inverse", group: "Explorer", element: <ExplorerRowIcon kind="folder" tone="inverse" /> },
  { name: "Kanban board", group: "Explorer", element: <KanbanBoardIcon />, note: "CSS-based icon" },
  { name: "Disclosure — closed", group: "Controls", element: <ExplorerDisclosureIcon open={false} color="currentColor" /> },
  { name: "Disclosure — open", group: "Controls", element: <ExplorerDisclosureIcon open color="currentColor" /> },
  { name: "Create node from selection", group: "Controls", element: <EditorSelectionNodeIcon /> },
];

const groups = [...new Set(icons.map((icon) => icon.group))];
const sections = groups.map((group) => {
  const cards = icons.filter((icon) => icon.group === group).map((icon) => {
    const markup = renderToStaticMarkup(icon.element);
    return `<article class="card" data-icon-name="${escapeHtml(icon.name)}">
      <div class="art">${markup}</div>
      <div class="name">${escapeHtml(icon.name)}</div>
      ${icon.note ? `<div class="note">${escapeHtml(icon.note)}</div>` : ""}
      <button type="button">Download SVG</button>
    </article>`;
  }).join("\n");
  return `<section><h2>${escapeHtml(group)}</h2><div class="grid">${cards}</div></section>`;
}).join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MangoRTS Icon Catalog</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#152033;background:#f6f8fb;--mango-brand-gradient:linear-gradient(135deg,#fbb152,#ff8820);--mango-font-family:Inter,ui-sans-serif,system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;padding:40px}.page{max-width:1160px;margin:auto}.eyebrow{color:#f06f24;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}h1{font-size:34px;margin:8px 0 6px}.intro{color:#5b687c;margin:0 0 36px}h2{font-size:18px;margin:32px 0 12px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.card{min-height:176px;padding:18px;border:1px solid #dce2eb;border-radius:14px;background:#fff;box-shadow:0 4px 16px rgba(28,39,60,.05)}.art{height:82px;display:flex;align-items:center;justify-content:center;color:#28364d;background:linear-gradient(145deg,#fbfcfe,#eef2f7);border-radius:10px;overflow:hidden}.art>svg,.art>span{transform:scale(2.35);transform-origin:center}.name{font-size:13px;font-weight:750;margin-top:13px}.note{font-size:11px;color:#7a8799;margin-top:3px}button{margin-top:9px;border:0;background:none;color:#e56420;font:inherit;font-size:11px;font-weight:750;padding:0;cursor:pointer}button:disabled{color:#a9b0ba;cursor:not-allowed}@media(max-width:560px){body{padding:22px}.grid{grid-template-columns:1fr 1fr}}
</style>
</head>
<body><main class="page"><div class="eyebrow">Design handoff</div><h1>MangoRTS Icon Catalog</h1><p class="intro">${icons.length} reusable icons and variants. Generated from <code>frontend/src/icons</code>.</p>${sections}</main>
<script>
document.querySelectorAll(".card").forEach((card) => {
  const button = card.querySelector("button");
  const svg = card.querySelector(".art > svg");
  if (!svg) { button.disabled = true; button.textContent = "Visual reference only"; return; }
  button.addEventListener("click", () => {
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.removeAttribute("aria-hidden");
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], {type: "image/svg+xml"});
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = card.dataset.iconName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".svg";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
});
</script></body></html>`;

const outputPath = resolve(process.cwd(), "docs/frontend/mangorts-icon-catalog.html");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, html, "utf8");
console.log(`Wrote ${icons.length} icon entries to ${outputPath}`);

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
