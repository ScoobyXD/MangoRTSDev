import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { CtrlLoopPage } from "../../../../frontend/src/pages/ctrl-loop/CtrlLoopPage.js";
import type { CtrlLoopJob } from "../../../../frontend/src/modules/ctrl-loop/ctrlLoopApi.js";

test("CtrlLoop renders the four states, reads real workbook cells, marks only displayed changes and clears company data", async () => {
  const browser = new Window({ url: "http://localhost:5173/ctrl-loop" });
  browser.document.title = "MangoRTS";
  const jobs: CtrlLoopJob[] = ["Awaiting file", "Listening", "Processing", "Error"].map((status, index) => ({
    id: `job-${index}`, name: `Automation ${index}`, instructions: "Stamp the shipped cell for matching purchase orders",
    email_connection_id: "mailbox-one", time_zone: "America/Los_Angeles", revision: 1,
    status: status as CtrlLoopJob["status"], file_name: index ? "Orders.xlsx" : "", unseen_updates: index === 1 ? 3 : 0,
    last_updated: index === 1 ? "2026-09-13T22:35:00Z" : null, error: index === 3 ? "Reconnect this mailbox to continue." : "",
  }));
  const seenBodies: unknown[] = [];
  const saveBodies: { method: string; body: Record<string, unknown> }[] = [];
  const uploaded: unknown[] = [];
  const calls: URL[] = [];
  let previewSignal: AbortSignal | null = null;
  let delayPreview = false;
  const replacements: Record<string, unknown> = {
    window: browser, document: browser.document, navigator: browser.navigator,
    HTMLElement: browser.HTMLElement, Node: browser.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: string, init: RequestInit) => {
      const url = new URL(input); calls.push(url);
      let payload: unknown = { jobs: url.searchParams.get("company_id") === "company-two" ? [] : jobs, mailboxes: [{ email_connection_id: "mailbox-one", account_email: "buyer@example.com", provider: "google", status: "connected" }] };
      if (init.method === "PATCH" || (init.method === "POST" && url.pathname.endsWith("/jobs"))) { saveBodies.push({ method: init.method, body: JSON.parse(init.body as string) }); payload = jobs[0]; }
      if (init.method === "POST" && url.pathname.endsWith("/workbook")) { uploaded.push(init.body); jobs[0].file_name = "Vendor.xlsx"; jobs[0].status = "Listening"; payload = jobs[0]; }
      if (url.pathname.endsWith("/preview")) {
        previewSignal = init.signal ?? null;
        if (delayPreview) return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
        payload = { sheets: [{ name: "Supplier WIP", rows: 88, columns: 22 }, { name: "Summary", rows: 2, columns: 3 }], sheet: { name: url.searchParams.get("sheet") || "Supplier WIP", start_row: 1, start_column: 1, rows: [{ row: 1, cells: [
          { address: "A1", column: 1, text: "PO 123" },
          { address: "B1", column: 2, text: "9/13/26 2:31PM", hyperlink: "https://mail.google.com/mail/u/buyer%40example.com/#all/18abc123" },
          { address: "C1", column: 3, text: "40", formula: "SUM(D2:D4)" },
          { address: "D1", column: 4, text: "Untrusted link", hyperlink: "javascript:alert(1)" },
        ] }] } };
      }
      if (url.pathname.endsWith("/changes")) payload = { has_more: false, runs: [{ id: "run-1", status: "completed", created_at: "2026-09-13T22:35:00Z", changed_cells: 2 }], changes: ["100", "99"].map((id) => ({ id, run_id: "run-1", job_id: "job-1", sheet: "Supplier WIP", cell: id === "100" ? "B5" : "C5", previous_text: "", text: "9/13/26 2:31PM", source_url: "https://mail.google.com/mail/u/buyer%40example.com/#all/18abc123", arrival_at: "2026-09-13T21:31:00Z", saved_at: "2026-09-13T22:35:00Z", seen: false })) };
      if (url.pathname.endsWith("/seen")) { seenBodies.push(JSON.parse(init.body as string)); jobs[1].unseen_updates = 1; payload = {}; }
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  };
  const originals = new Map(Object.keys(replacements).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.entries(replacements).forEach(([key, value]) => Object.defineProperty(globalThis, key, { configurable: true, value }));
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<CtrlLoopPage key="one" companyID="company-one" currentUserID="" />); });
    assert.equal(document.title, "[3] [CTRL] Loop");
    for (const status of ["Awaiting file", "Listening", "Processing", "Error"]) assert.ok(document.body.textContent?.includes(status));
    assert.ok(document.body.textContent?.includes("Reconnect this mailbox"));
    assert.equal(document.querySelectorAll('input[type="file"]').length, 1);
    await act(async () => { Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "+ New automation")!.click(); });
    const form = document.querySelector<HTMLFormElement>(".ctrl-loop-form")!;
    const nameInput = form.querySelector<HTMLInputElement>("input")!;
    const instructionsInput = form.querySelector<HTMLTextAreaElement>("textarea")!;
    const timezoneInput = form.querySelectorAll<HTMLInputElement>("input")[1];
    await act(async () => {
      Simulate.change(nameInput, { target: { value: " New job " } } as never);
      Simulate.change(instructionsInput, { target: { value: " Stamp shipment confirmations " } } as never);
      Simulate.change(timezoneInput, { target: { value: "Invalid/Zone" } } as never);
    });
    await act(async () => { Simulate.submit(form); });
    assert.ok(document.body.textContent?.includes("Enter a valid timezone"));
    assert.equal(saveBodies.length, 0);
    await act(async () => { Simulate.change(timezoneInput, { target: { value: "America/Los_Angeles" } } as never); });
    await act(async () => { Simulate.submit(form); });
    assert.equal(saveBodies[0].method, "POST");
    assert.equal(saveBodies[0].body.name, "New job");
    assert.equal(saveBodies[0].body.instructions, "Stamp shipment confirmations");
    assert.equal(saveBodies[0].body.email_connection_id, "mailbox-one");
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await act(async () => { document.querySelector<HTMLButtonElement>(".ctrl-loop-name")!.click(); });
    await act(async () => { Simulate.submit(document.querySelector<HTMLFormElement>(".ctrl-loop-form")!); });
    assert.equal(saveBodies[1].method, "PATCH");
    assert.equal(saveBodies[1].body.revision, 1);
    const uploadInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => { Simulate.change(uploadInput, { target: { files: [new File(["csv"], "data.csv")] } } as never); });
    assert.equal(uploaded.length, 0);
    assert.ok(document.body.textContent?.includes("Choose an Excel .xlsx file."));
    const workbook = new File(["workbook"], "Vendor.xlsx");
    await act(async () => { Simulate.change(uploadInput, { target: { files: [workbook] } } as never); });
    assert.equal(uploaded[0], workbook);
    assert.equal(document.querySelectorAll('input[type="file"]').length, 0);
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="3 unseen updates for Automation 1"]')!.click(); });
    assert.deepEqual(seenBodies, [{ change_ids: ["100", "99"] }]);
    assert.equal(document.querySelectorAll("[data-change-id]").length, 2);
    assert.equal(document.title, "[1] [CTRL] Loop", "a newer unseen cell outside the read history must remain unread");
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click(); });
    await act(async () => { document.querySelector<HTMLButtonElement>(".ctrl-loop-file")!.click(); });
    const stamp = document.querySelector<HTMLAnchorElement>('[data-cell="B1"] a')!;
    assert.equal(stamp.textContent, "9/13/26 2:31PM");
    assert.equal(stamp.target, "_blank");
    assert.ok(stamp.href.startsWith("https://mail.google.com/"));
    assert.equal(document.querySelector('[data-cell="D1"] a'), null);
    assert.ok(document.querySelector('[data-cell="C1"]')!.getAttribute("title")!.includes("SUM(D2:D4)"));
    assert.equal(document.querySelector("[contenteditable]"), null);
    const nextRows = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Next rows")!;
    await act(async () => { nextRows.click(); });
    assert.ok(calls.some((url) => url.searchParams.get("start_row") === "41"));
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click(); });
    delayPreview = true;
    await act(async () => { document.querySelector<HTMLButtonElement>(".ctrl-loop-file")!.click(); });
    await act(async () => { root.render(<CtrlLoopPage key="two" companyID="company-two" currentUserID="" />); });
    assert.ok((previewSignal as unknown as AbortSignal).aborted);
    assert.ok(!document.body.textContent?.includes("Automation 1"));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.title, "[CTRL] Loop");
  } finally {
    await act(async () => { root.unmount(); });
    assert.equal(document.title, "MangoRTS");
    originals.forEach((descriptor, key) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
    await browser.happyDOM.close();
  }
});
