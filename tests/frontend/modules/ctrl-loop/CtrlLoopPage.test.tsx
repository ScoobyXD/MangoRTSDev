import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { CtrlLoopPage } from "../../../../frontend/src/pages/ctrl-loop/CtrlLoopPage.js";
import type { CtrlLoopJob } from "../../../../frontend/src/modules/ctrl-loop/ctrlLoopApi.js";

async function withPageBrowser(fetch: (input: string, init: RequestInit) => Promise<Response>, run: (root: Root) => Promise<void>) {
  const browser = new Window({ url: "http://localhost:5173/ctrl-loop" });
  browser.document.title = "MangoRTS";
  const replacements: Record<string, unknown> = {
    window: browser, document: browser.document, navigator: browser.navigator,
    HTMLElement: browser.HTMLElement, Node: browser.Node, IS_REACT_ACT_ENVIRONMENT: true, fetch,
  };
  const originals = new Map(Object.keys(replacements).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.entries(replacements).forEach(([key, value]) => Object.defineProperty(globalThis, key, { configurable: true, value }));
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  try { await run(root); }
  finally {
    await act(async () => { root.unmount(); });
    assert.equal(document.title, "MangoRTS");
    originals.forEach((descriptor, key) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
    await browser.happyDOM.close();
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function button(label: string) {
  const found = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.replace(/^\+\s*/, "").trim() === label);
  assert.ok(found, `Expected a ${label} button`);
  return found;
}

const existingJob: CtrlLoopJob = {
  id: "existing-job", name: "Existing Loop", instructions: "Keep the shipment confirmations.",
  email_connection_id: "original-mailbox", time_zone: "Asia/Tokyo", revision: 7,
  status: "Awaiting file", unseen_updates: 0,
};

test("CtrlLoop creates a row with browser defaults and the signed-in mailbox, then edits instructions in a separate dialog", async () => {
  const saves: { method: string; body: Record<string, unknown> }[] = [];
  let jobs = [existingJob];
  let listCalls = 0;
  await withPageBrowser(async (_input, init) => {
    if (init.method === "POST" || init.method === "PATCH") {
      const body = JSON.parse(init.body as string);
      saves.push({ method: init.method, body });
      const saved = init.method === "POST"
        ? { ...existingJob, ...body, id: "new-job", revision: 1, status: "Error", error: "Reconnect this mailbox to continue." }
        : { ...existingJob, ...body, revision: existingJob.revision + 1 };
      jobs = init.method === "POST" ? [...jobs, saved] : jobs.map((job) => job.id === saved.id ? saved : job);
      return jsonResponse(saved);
    }
    listCalls++;
    return jsonResponse({ jobs, mailboxes: [
      { email_connection_id: "other-mailbox", account_email: "someone-else@example.com", provider: "google", status: "connected" },
      { email_connection_id: "my-mailbox", account_email: "BUYER@example.com", provider: "google", status: "needs_reauth" },
    ] });
  }, async (root) => {
    await act(async () => { root.render(<CtrlLoopPage companyID="company-one" currentUserID="" currentUserEmail="buyer@EXAMPLE.com" />); });
    assert.equal(Array.from(document.querySelectorAll("button")).some((item) => /^(Refresh|\+ New automation)$/.test(item.textContent ?? "")), false);
    const create = button("Create New Loop");
    assert.equal(create.closest(".ctrl-loop-heading"), null, "creation belongs directly above the table");
    await act(async () => { create.click(); });
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(saves.length, 1);
    assert.equal(saves[0].method, "POST");
    assert.equal(saves[0].body.name, "New Loop");
    assert.equal(saves[0].body.email_connection_id, "my-mailbox", "another connected mailbox must not replace the signed-in mailbox needing reauthorization");
    assert.equal(saves[0].body.time_zone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    const instructions = String(saves[0].body.instructions);
    assert.ok(instructions.startsWith("Track order milestones using incoming emails."));
    assert.equal(instructions.match(/^\d+\./gm)?.length, 8);
    assert.match(instructions, /date\/time|date and time/i);
    assert.match(instructions, /9\/13\/26 2:31PM/);
    assert.match(instructions, /clickable/i);
    assert.match(instructions, /time ?zone/i);
    assert.match(instructions, /Never guess/);
    assert.equal(document.querySelectorAll(".ctrl-loop-name").length, 2);
    assert.ok(document.body.textContent?.includes("Reconnect this mailbox to continue."));
    assert.equal(listCalls, 1, "the saved row must appear without waiting for another list request");
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Edit instructions for New Loop"]')!.click(); });
    assert.equal(document.querySelector<HTMLTextAreaElement>(".ctrl-loop-form textarea")!.value, instructions, "the editor must contain every line of the default instruction");
    await act(async () => { button("Cancel").click(); });

    const existingRow = button("Existing Loop").closest("tr")!;
    await act(async () => { existingRow.querySelector<HTMLButtonElement>(".ctrl-loop-instructions button")!.click(); });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    assert.ok(dialog);
    assert.equal(document.querySelector(".ctrl-loop-table")!.contains(dialog), false);
    const form = dialog.querySelector<HTMLFormElement>(".ctrl-loop-form")!;
    assert.equal(form.querySelectorAll("input").length, 1, "only the name is an input; the existing timezone is preserved");
    assert.equal(form.querySelector("select"), null, "editing does not choose a different mailbox");
    const instructionsInput = form.querySelector<HTMLTextAreaElement>("textarea")!;
    assert.equal(instructionsInput.value, existingJob.instructions);
    await act(async () => { Simulate.change(instructionsInput, { target: { value: "Unsaved instruction" } } as never); });
    await act(async () => { button("Cancel").click(); });
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(saves.length, 1);
    assert.equal(existingRow.querySelector(".ctrl-loop-instructions button")!.textContent, existingJob.instructions);

    await act(async () => { button("Existing Loop").click(); });
    const editForm = document.querySelector<HTMLFormElement>(".ctrl-loop-form")!;
    assert.equal(editForm.querySelector<HTMLTextAreaElement>("textarea")!.value, existingJob.instructions);
    await act(async () => {
      Simulate.change(editForm.querySelector<HTMLInputElement>("input")!, { target: { value: " Renamed Loop " } } as never);
      Simulate.change(editForm.querySelector<HTMLTextAreaElement>("textarea")!, { target: { value: " Stamp only completed shipments. " } } as never);
    });
    await act(async () => { Simulate.submit(editForm); });
    assert.deepEqual(saves[1], { method: "PATCH", body: {
      name: "Renamed Loop", instructions: "Stamp only completed shipments.",
      email_connection_id: existingJob.email_connection_id, time_zone: existingJob.time_zone, revision: existingJob.revision,
    } });
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(button("Renamed Loop").closest("tr")!.querySelector(".ctrl-loop-instructions button")!.textContent, "Stamp only completed shipments.");
  });
});

test("CtrlLoop refuses to substitute a different email account when the signed-in mailbox is missing", async () => {
  let writes = 0;
  await withPageBrowser(async (_input, init) => {
    if (init.method === "POST") writes++;
    return jsonResponse({ jobs: [], mailboxes: [
      { email_connection_id: "other-mailbox", account_email: "someone-else@example.com", provider: "google", status: "connected" },
    ] });
  }, async (root) => {
    await act(async () => { root.render(<CtrlLoopPage companyID="company-one" currentUserID="" currentUserEmail="buyer@example.com" />); });
    await act(async () => { button("Create New Loop").click(); });
    assert.equal(writes, 0);
    assert.equal(document.querySelector(".ctrl-loop-name"), null);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /connect.*buyer@example\.com/i);
  });
});

test("CtrlLoop prevents duplicate creation while saving and allows retry after a failed request", async () => {
  let writes = 0;
  let completeRequest!: (response: Response) => void;
  await withPageBrowser(async (_input, init) => {
    if (init.method === "POST") {
      writes++;
      if (writes === 1) return new Promise<Response>((resolve) => { completeRequest = resolve; });
      return jsonResponse({ ...existingJob, ...JSON.parse(init.body as string), id: "new-job", revision: 1 });
    }
    return jsonResponse({ jobs: [], mailboxes: [
      { email_connection_id: "my-mailbox", account_email: "buyer@example.com", provider: "google", status: "connected" },
    ] });
  }, async (root) => {
    await act(async () => { root.render(<CtrlLoopPage companyID="company-one" currentUserID="" currentUserEmail="buyer@example.com" />); });
    const create = button("Create New Loop");
    await act(async () => { create.click(); });
    await act(async () => { create.click(); });
    assert.equal(writes, 1);
    assert.equal(create.disabled, true);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await act(async () => { completeRequest(jsonResponse({ error: "The loop could not be created." }, 400)); });
    assert.equal(create.disabled, false);
    assert.ok(document.querySelector('[role="alert"]'));
    assert.equal(document.querySelector(".ctrl-loop-name"), null, "failed creation must not leave an unsaved row");
    await act(async () => { button("Create New Loop").click(); });
    assert.equal(writes, 2);
    assert.equal(document.querySelectorAll(".ctrl-loop-name").length, 1);
    assert.equal(document.querySelector('[role="alert"]'), null);
  });
});

test("CtrlLoop renders the four states, reads real workbook cells, marks only displayed changes and clears company data", async () => {
  const jobs: CtrlLoopJob[] = ["Awaiting file", "Listening", "Processing", "Error"].map((status, index) => ({
    id: `job-${index}`, name: `Automation ${index}`, instructions: "Stamp the shipped cell for matching purchase orders",
    email_connection_id: "mailbox-one", time_zone: "America/Los_Angeles", revision: 1,
    status: status as CtrlLoopJob["status"], file_name: index ? "Orders.xlsx" : "", unseen_updates: index === 1 ? 3 : 0,
    last_updated: index === 1 ? "2026-09-13T22:35:00Z" : null, error: index === 3 ? "Reconnect this mailbox to continue." : "",
  }));
  const seenBodies: unknown[] = [];
  const uploaded: unknown[] = [];
  const calls: URL[] = [];
  let previewSignal: AbortSignal | null = null;
  let delayPreview = false;
  await withPageBrowser(async (input, init) => {
      const url = new URL(input); calls.push(url);
      let payload: unknown = { jobs: url.searchParams.get("company_id") === "company-two" ? [] : jobs, mailboxes: [{ email_connection_id: "mailbox-one", account_email: "buyer@example.com", provider: "google", status: "connected" }] };
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
      return jsonResponse(payload);
  }, async (root) => {
    await act(async () => { root.render(<CtrlLoopPage key="one" companyID="company-one" currentUserID="" currentUserEmail="buyer@example.com" />); });
    assert.equal(document.title, "[3] [CTRL] Loop");
    for (const status of ["Awaiting file", "Listening", "Processing", "Error"]) assert.ok(document.body.textContent?.includes(status));
    assert.ok(document.body.textContent?.includes("Reconnect this mailbox"));
    assert.equal(document.querySelectorAll('input[type="file"]').length, 1);
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
    await act(async () => { root.render(<CtrlLoopPage key="two" companyID="company-two" currentUserID="" currentUserEmail="buyer@example.com" />); });
    assert.ok((previewSignal as unknown as AbortSignal).aborted);
    assert.ok(!document.body.textContent?.includes("Automation 1"));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.title, "[CTRL] Loop");
  });
});
