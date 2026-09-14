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

test("CtrlLoop deletion requires confirmation, retains a failed row and removes only the target after success", async () => {
  const jobs: CtrlLoopJob[] = [
    { ...existingJob, file_name: "Orders.xlsx", status: "Listening", unseen_updates: 3 },
    { ...existingJob, id: "other-job", name: "Other Loop", unseen_updates: 2 },
  ];
  const confirmations: string[] = [];
  let confirmed = false;
  let writes = 0;
  let listCalls = 0;
  let completeRequest!: (response: Response) => void;
  await withPageBrowser(async (input, init) => {
    if (init.method === "DELETE") {
      writes++;
      assert.equal(new URL(input).pathname, "/v1/ctrl-loop/jobs/existing-job");
      if (writes === 1) return new Promise<Response>((resolve) => { completeRequest = resolve; });
      return new Response(null, { status: 204 });
    }
    listCalls++;
    return jsonResponse({ jobs, mailboxes: [] });
  }, async (root) => {
    window.confirm = (message) => { confirmations.push(message ?? ""); return confirmed; };
    await act(async () => { root.render(<CtrlLoopPage companyID="company-one" currentUserID="" currentUserEmail="buyer@example.com" />); });
    const remove = document.querySelector<HTMLButtonElement>('[aria-label="Delete loop Existing Loop"]')!;
    await act(async () => { remove.click(); });
    assert.equal(writes, 0);
    assert.equal(document.querySelectorAll(".ctrl-loop-name").length, 2);
    assert.match(confirmations[0], /Permanently delete.*Existing Loop/);
    assert.match(confirmations[0], /workbooks.*history/);
    assert.match(confirmations[0], /Source emails will stay/);
    confirmed = true;
    await act(async () => { remove.click(); });
    assert.equal(remove.textContent, "Deleting…");
    assert.equal(document.querySelectorAll(".ctrl-loop-name").length, 2, "the pending request must leave the saved row visible");
    assert.equal(button("Create New Loop").disabled, true);
    assert.equal(button("Existing Loop").disabled, true);
    assert.equal(document.querySelector<HTMLButtonElement>('[aria-label="Edit instructions for Existing Loop"]')!.disabled, true);
    assert.equal(document.querySelector<HTMLButtonElement>(".ctrl-loop-file")!.disabled, true);
    assert.equal(document.querySelector<HTMLButtonElement>('[aria-label="Download latest workbook for Existing Loop"]')!.disabled, true);
    assert.equal(document.querySelector<HTMLInputElement>('input[type="file"]')!.disabled, true);
    assert.equal(document.querySelector<HTMLButtonElement>('[aria-label="Delete loop Other Loop"]')!.disabled, true);
    await act(async () => { remove.click(); });
    assert.equal(writes, 1);
    await act(async () => { completeRequest(jsonResponse({ error: "The loop is processing. Try again after it finishes." }, 409)); });
    assert.equal(remove.disabled, false);
    assert.equal(document.querySelectorAll(".ctrl-loop-name").length, 2);
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /processing/i);
    await act(async () => { remove.click(); });
    assert.equal(writes, 2);
    assert.equal(document.querySelectorAll(".ctrl-loop-name").length, 1);
    assert.equal(document.querySelector('[aria-label="Delete loop Existing Loop"]'), null);
    assert.ok(button("Other Loop"));
    assert.equal(document.title, "[2] [CTRL] Loop");
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.equal(listCalls, 1, "deletion removes the target without replacing other rows from a new list response");
  });
});

test("CtrlLoop filename opens the authorized latest workbook in Excel without a preview", async () => {
  const calls: URL[] = [];
  let fail = false;
  await withPageBrowser(async (input) => {
    const url = new URL(input); calls.push(url);
    if (url.pathname.endsWith("/open")) return fail ? jsonResponse({ error: "Workbook unavailable" }, 404) : jsonResponse({ url: "https://files.example.com/current.xlsx?signature=abc%2B123" });
    return jsonResponse({ jobs: [{ ...existingJob, file_name: "Orders.xlsx" }], mailboxes: [] });
  }, async (root) => {
    const launched: string[] = [];
    document.addEventListener("click", (event) => {
      const target = event.target as HTMLAnchorElement;
      if (target.tagName === "A") { event.preventDefault(); launched.push(target.href); }
    });
    await act(async () => { root.render(<CtrlLoopPage companyID="company-one" currentUserID="" currentUserEmail="buyer@example.com" />); });
    await act(async () => { document.querySelector<HTMLButtonElement>(".ctrl-loop-file")!.click(); });
    assert.deepEqual(launched, ["ms-excel:ofv|u|https://files.example.com/current.xlsx?signature=abc%2B123"]);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(calls.at(-1)?.pathname, "/v1/ctrl-loop/jobs/existing-job/open");
    assert.equal(calls.at(-1)?.searchParams.get("company_id"), "company-one");
    assert.equal(calls.some((url) => url.pathname.endsWith("/preview")), false);
    fail = true;
    await act(async () => { document.querySelector<HTMLButtonElement>(".ctrl-loop-file")!.click(); });
    assert.equal(launched.length, 1);
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /unavailable/i);
    assert.equal(document.querySelector<HTMLButtonElement>(".ctrl-loop-file")!.disabled, false);
  });
});

test("CtrlLoop cancels a pending Excel launch when the company changes", async () => {
  let signal: AbortSignal | undefined;
  await withPageBrowser(async (input, init) => {
    if (new URL(input).pathname.endsWith("/open")) {
      signal = init.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    }
    return jsonResponse({ jobs: [{ ...existingJob, file_name: "Orders.xlsx" }], mailboxes: [] });
  }, async (root) => {
    await act(async () => { root.render(<CtrlLoopPage key="one" companyID="company-one" currentUserID="" currentUserEmail="buyer@example.com" />); });
    await act(async () => { document.querySelector<HTMLButtonElement>(".ctrl-loop-file")!.click(); });
    assert.equal(document.querySelector<HTMLButtonElement>(".ctrl-loop-file")!.disabled, true);
    await act(async () => { root.render(<CtrlLoopPage key="two" companyID="company-two" currentUserID="" currentUserEmail="buyer@example.com" />); });
    assert.equal(signal?.aborted, true);
  });
});

test("CtrlLoop renders the four states, uploads workbooks, marks only displayed changes and clears company data", async () => {
  const jobs: CtrlLoopJob[] = ["Awaiting file", "Listening", "Processing", "Error"].map((status, index) => ({
    id: `job-${index}`, name: `Automation ${index}`, instructions: "Stamp the shipped cell for matching purchase orders",
    email_connection_id: "mailbox-one", time_zone: "America/Los_Angeles", revision: 1,
    status: status as CtrlLoopJob["status"], file_name: index ? "Orders.xlsx" : "", unseen_updates: index === 1 ? 3 : 0,
    last_updated: index === 1 ? "2026-09-13T22:35:00Z" : null, error: index === 3 ? "Reconnect this mailbox to continue." : "",
  }));
  const seenBodies: unknown[] = [];
  const uploaded: unknown[] = [];
  const calls: URL[] = [];
  await withPageBrowser(async (input, init) => {
      const url = new URL(input); calls.push(url);
      let payload: unknown = { jobs: url.searchParams.get("company_id") === "company-two" ? [] : jobs, mailboxes: [{ email_connection_id: "mailbox-one", account_email: "buyer@example.com", provider: "google", status: "connected" }] };
      if (init.method === "POST" && url.pathname.endsWith("/workbook")) { uploaded.push(init.body); jobs[0].file_name = "Vendor.xlsx"; jobs[0].status = "Listening"; payload = jobs[0]; }
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
    await act(async () => { root.render(<CtrlLoopPage key="two" companyID="company-two" currentUserID="" currentUserEmail="buyer@example.com" />); });
    assert.ok(!document.body.textContent?.includes("Automation 1"));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.title, "[CTRL] Loop");
  });
});
