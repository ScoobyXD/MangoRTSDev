import test from "node:test";
import assert from "node:assert/strict";
import {
  ctrlLoopTitle, downloadCtrlLoopWorkbook, getCtrlLoopHistory, markCtrlLoopChangesSeen,
  previewCtrlLoopWorkbook, saveCtrlLoopJob, uploadCtrlLoopWorkbook, workbookWebLink,
} from "../../../../frontend/src/modules/ctrl-loop/ctrlLoopApi.js";

test("CtrlLoop API preserves company scope, exact seen IDs, upload bytes and binary downloads", async () => {
  const previousFetch = globalThis.fetch;
  const calls: { url: URL; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit) => {
    calls.push({ url: new URL(input), init });
    return new Response((init.method ?? "GET") === "GET" && input.includes("/workbook?") ? "xlsx bytes" : "{}", { status: 200 });
  }) as typeof fetch;
  try {
    const file = new File(["original workbook bytes"], "采购 orders.xlsx");
    await uploadCtrlLoopWorkbook("company A", "job/1", file);
    assert.equal(calls[0].url.pathname, "/v1/ctrl-loop/jobs/job%2F1/workbook");
    assert.equal(calls[0].url.searchParams.get("company_id"), "company A");
    assert.equal(calls[0].init.body, file);
    assert.equal(new Headers(calls[0].init.headers).get("X-Filename"), encodeURIComponent(file.name));
    await assert.rejects(uploadCtrlLoopWorkbook("company A", "job/1", new File(["csv"], "workbook.csv")), /\.xlsx/);
    assert.equal(calls.length, 1);
    await markCtrlLoopChangesSeen("company A", "job/1", ["9007199254740995", "901"]);
    assert.deepEqual(JSON.parse(calls[1].init.body as string), { change_ids: ["9007199254740995", "901"] });
    const current = await downloadCtrlLoopWorkbook("company A", "job/1", "current");
    const original = await downloadCtrlLoopWorkbook("company A", "job/1", "original");
    assert.equal(await current.text(), "xlsx bytes");
    assert.equal(await original.text(), "xlsx bytes");
    assert.equal(calls[2].url.searchParams.get("version"), "current");
    assert.equal(calls[3].url.searchParams.get("version"), "original");
    await previewCtrlLoopWorkbook("company A", "job/1", "Vendor WIP", 41, 21);
    assert.equal(calls[4].url.searchParams.get("sheet"), "Vendor WIP");
    assert.equal(calls[4].url.searchParams.get("start_row"), "41");
    assert.equal(calls[4].url.searchParams.get("start_column"), "21");
    await getCtrlLoopHistory("company A", "job/1", "9007199254740995");
    assert.equal(calls[5].url.searchParams.get("before_id"), "9007199254740995");
    const input = { name: "Orders", instructions: "Stamp shipped cell", email_connection_id: "mailbox-one", time_zone: "America/Los_Angeles" };
    await saveCtrlLoopJob("company A", input, { ...input, id: "job/1", revision: 4, status: "Listening", unseen_updates: 3 });
    assert.equal(calls[6].init.method, "PATCH");
    assert.equal(JSON.parse(calls[6].init.body as string).revision, 4);
  } finally { globalThis.fetch = previousFetch; }
});

test("workbook links stay direct and reject executable URLs while the title aggregates saved counts", () => {
  const gmail = "https://mail.google.com/mail/u/customer%40example.com/#all/18abc123";
  const outlook = "https://outlook.office365.com/owa/?ItemID=AAMk123&exvsurl=1&viewmodel=ReadMessageItem";
  assert.equal(workbookWebLink(gmail), gmail);
  assert.equal(workbookWebLink(outlook), outlook);
  for (const link of ["javascript:alert(1)", "data:text/html,hello", "file:///C:/secrets", "/source-email/1", "https://user:password@example.com"]) assert.equal(workbookWebLink(link), undefined);
  assert.equal(ctrlLoopTitle([{ unseen_updates: 2 }, { unseen_updates: 1 }, { unseen_updates: 0 }]), "[3] [CTRL] Loop");
  assert.equal(ctrlLoopTitle([]), "[CTRL] Loop");
});
