import test from "node:test";
import assert from "node:assert/strict";
import type { EmailMessage } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import {
  normalizeEmailThreadMessages,
  type EmailThreadMessageCandidate,
} from "../../../../frontend/src/modules/communications/emailThreadMessages.js";

function message(id: string, overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id,
    thread_id: "thread-ap",
    subject: "Re: A/N for OI-41329 / COSU6502396670 / CSLU1990929",
    body: "<p>Hello</p>",
    snippet: "Hello",
    date: 1_773_706_000,
    unread: false,
    starred: false,
    from: [{ name: "Giang Tran", email: "ap@180snacks.com" }],
    to: [{ name: "Yimin Zhang", email: "yimin.zhang@lqcprinting.com" }],
    ...overrides,
  };
}

function candidate(
  source: EmailThreadMessageCandidate["source"],
  value: EmailMessage,
): EmailThreadMessageCandidate {
  return { source, scopeKey: "shared:ap", message: value };
}

test("exact provider identity is one timeline message with the richest detail", () => {
  const normalized = normalizeEmailThreadMessages([
    candidate("provider", message("provider-1", { body: undefined, detail_fetched: false })),
    candidate("provider", message("provider-1", { body: "<p>Detailed body</p>", detail_fetched: true })),
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, "provider-1");
  assert.equal(normalized[0].body, "<p>Detailed body</p>");
  assert.deepEqual(normalized[0].client_thread_sources, ["provider"]);
  assert.deepEqual(normalized[0].client_reconciled_message_ids, ["provider-1"]);
});

test("local sent representations reconcile with one authoritative provider message", () => {
  const provider = message("provider-final", {
    body: "<p>Hello, Yimin,</p><p>Please see the remittances attached below for 15 invoices. Thank you!</p>",
    attachments: [{ id: "provider-wire", filename: "Wire Details.pdf", content_type: "application/pdf", size: 64_000 }],
  });
  const localBody = "<div>Hello, Yimin,</div><div>Please see the remittances attached below for 15 invoices. Thank you!</div>";
  const normalized = normalizeEmailThreadMessages([
    candidate("provider", provider),
    candidate("local", message("send-response-a", {
      body: localBody,
      attachments: [{ attachment_id: "mango-wire-a", filename: "Wire Details.pdf", content_type: "application/pdf", size: 64_000 }],
    })),
    candidate("local", message("send-response-b", {
      body: localBody,
      attachments: [{ attachment_id: "mango-wire-b", filename: "Wire Details.pdf", content_type: "application/pdf", size: 64_000 }],
    })),
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, "provider-final");
  assert.deepEqual(normalized[0].client_thread_sources, ["provider", "local"]);
  assert.deepEqual(normalized[0].client_reconciled_message_ids, ["provider-final", "send-response-a", "send-response-b"]);
  assert.equal(normalized[0].attachments?.[0]?.id, "provider-wire");
});

test("the screenshot-class Giang duplication still produces six real messages", () => {
  const olderMessages = [
    message("andy-clearance", { date: 1_771_000_100, from: [{ email: "alee@dnachb.com" }], body: "See attached clearance doc" }),
    message("luke-received", { date: 1_771_000_200, from: [{ email: "luke.mendoza@180snacks.com" }], body: "Thank you for the clearance doc" }),
    message("yimin-documents", { date: 1_771_000_300, from: [{ email: "yimin.zhang@lqcprinting.com" }], body: "Please find the documents attached" }),
    message("giang-bank", { date: 1_771_000_400, body: "Could you kindly verify the bank details?" }),
    message("giang-ack", { date: 1_771_000_500, body: "Thank you for sending over the updated invoice!" }),
  ];
  const finalProvider = message("giang-remittance", {
    date: 1_771_000_600,
    body: "Hello, Yimin, Please see the remittances attached below for 15 invoices. Thank you!",
  });
  const candidates: EmailThreadMessageCandidate[] = [
    ...olderMessages.map((value) => candidate("provider", value)),
    candidate("provider", finalProvider),
    candidate("local", { ...finalProvider, id: "local-remittance-a" }),
    candidate("local", { ...finalProvider, id: "local-remittance-b" }),
  ];

  const normalized = normalizeEmailThreadMessages(candidates);

  assert.equal(normalized.length, 6);
  assert.deepEqual(normalized.map((value) => value.id), [
    "andy-clearance",
    "luke-received",
    "yimin-documents",
    "giang-bank",
    "giang-ack",
    "giang-remittance",
  ]);
});

test("identical provider messages with different IDs remain separate", () => {
  const normalized = normalizeEmailThreadMessages([
    candidate("provider", message("provider-a")),
    candidate("provider", message("provider-b")),
  ]);

  assert.deepEqual(normalized.map((value) => value.id), ["provider-a", "provider-b"]);
});

test("provider and local copies reconcile when only their quoted-history wrappers differ", () => {
  const providerBody = `<div>Thanks, Yimin.</div><div class="gmail_quote"><div>On Jul 14, Yimin wrote:</div><blockquote>Earlier message</blockquote></div>`;
  const localBody = `Thanks, Yimin.\n\n-----Original Message-----\nFrom: Yimin Zhang <yimin@example.com>\nSent: Tuesday, July 14, 2026 10:00 AM\nTo: Giang Tran <ap@180snacks.com>\nSubject: Re: A/N\n\nEarlier message`;
  const normalized = normalizeEmailThreadMessages([
    candidate("provider", message("provider-a", { body: providerBody })),
    candidate("local", message("local-a", { body: localBody })),
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, "provider-a");
  assert.deepEqual(normalized[0].client_thread_sources, ["provider", "local"]);
});
test("different attachment ownership prevents local reconciliation", () => {
  const normalized = normalizeEmailThreadMessages([
    candidate("provider", message("provider-a", {
      attachments: [{ id: "invoice-a", filename: "Invoice A.pdf", content_type: "application/pdf", size: 10 }],
    })),
    candidate("local", message("local-b", {
      attachments: [{ id: "invoice-b", filename: "Invoice B.pdf", content_type: "application/pdf", size: 10 }],
    })),
  ]);

  assert.equal(normalized.length, 2);
});

test("a local reply may inherit the containing provider thread before reconciliation", () => {
  const provider = message("provider-a");
  const local = message("local-a", { thread_id: undefined });
  const normalized = normalizeEmailThreadMessages([
    candidate("provider", provider),
    { ...candidate("local", local), inheritedThreadID: "thread-ap" },
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, "provider-a");
});

test("newest ordering is optional and deterministic without changing identity", () => {
  const candidates = [
    candidate("provider", message("middle", { date: 200 })),
    candidate("provider", message("oldest", { date: 100 })),
    candidate("provider", message("newest", { date: 300 })),
  ];

  assert.deepEqual(normalizeEmailThreadMessages(candidates).map((value) => value.id), ["oldest", "middle", "newest"]);
  assert.deepEqual(normalizeEmailThreadMessages(candidates, "newest").map((value) => value.id), ["newest", "middle", "oldest"]);
});

test("durable stored thread order wins over inconsistent display timestamps", () => {
  const candidates = [
    candidate("collaboration", message("third", { date: 100, message_order: 2 })),
    candidate("collaboration", message("first", { date: 300_000, message_order: 0 })),
    candidate("collaboration", message("second", { date: 200, message_order: 1 })),
  ];

  assert.deepEqual(normalizeEmailThreadMessages(candidates).map((value) => value.id), ["first", "second", "third"]);
  assert.deepEqual(normalizeEmailThreadMessages(candidates, "newest").map((value) => value.id), ["third", "second", "first"]);
});

test("provider gaps cannot reverse the durable relative order of stored messages", () => {
  const candidates = [
    candidate("collaboration", message("stored-first", { date: 300, message_order: 0 })),
    candidate("provider", message("provider-gap", { date: 200 })),
    candidate("collaboration", message("stored-second", { date: 100, message_order: 1 })),
  ];

  assert.deepEqual(normalizeEmailThreadMessages(candidates).map((value) => value.id), [
    "provider-gap",
    "stored-first",
    "stored-second",
  ]);
  assert.deepEqual(normalizeEmailThreadMessages(candidates, "newest").map((value) => value.id), [
    "stored-second",
    "stored-first",
    "provider-gap",
  ]);
});
