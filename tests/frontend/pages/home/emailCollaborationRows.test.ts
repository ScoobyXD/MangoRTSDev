import test from "node:test";
import assert from "node:assert/strict";
import type {
  CommunicationsEmailCollaboration,
  EmailMessage,
} from "../../../../frontend/src/modules/communications/communicationsApi.js";
import {
  emailCollaborationListMessage,
  emailMessageMatchesCollaboration,
  emailMessageUsesActiveProviderScope,
  mergeEmailCollaborationsForView,
  sharedInboxIDForHomeView,
} from "../../../../frontend/src/pages/home/emailCollaborationRows.js";
import {
  condenseEmailThreadMessages,
  emailMessageRowKey,
  emailThreadKey,
} from "../../../../frontend/src/pages/home/homeUtils.js";

function message(id: string, overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id,
    subject: "Review",
    unread: false,
    starred: false,
    ...overrides,
  };
}

function collaboration(
  id: string,
  overrides: Partial<CommunicationsEmailCollaboration> = {},
): CommunicationsEmailCollaboration {
  return {
    company_id: "company-1",
    collaboration_id: id,
    node_id: `node-${id}`,
    attached_email_information_id: `information-${id}`,
    latest_message: message(`message-${id}`, { thread_id: `thread-${id}` }),
    ...overrides,
  };
}

test("active-provider checks keep collaboration mutations inside their immutable source mailbox", () => {
  assert.equal(sharedInboxIDForHomeView("shared: shared-1 "), "shared-1");
  assert.equal(emailMessageUsesActiveProviderScope(message("ordinary"), "shared:shared-2", "user-1", "me@example.test"), true);

  const sharedMessage = message("shared", {
    collaboration_id: "collaboration-shared",
    collaboration_shared_inbox_id: "shared-1",
  });
  assert.equal(emailMessageUsesActiveProviderScope(sharedMessage, "shared:shared-1", "user-1", "me@example.test"), true);
  assert.equal(emailMessageUsesActiveProviderScope(sharedMessage, "shared:shared-2", "user-1", "me@example.test"), false);
  assert.equal(emailMessageUsesActiveProviderScope(sharedMessage, "my-triage", "user-1", "me@example.test"), false);

  const personalMessage = message("personal", {
    collaboration_id: "collaboration-personal",
    collaboration_personal_user_id: "user-1",
    collaboration_account_email: "Owner@Example.Test",
  });
  assert.equal(emailMessageUsesActiveProviderScope(personalMessage, "my-triage", " user-1 ", " owner@example.test "), true);
  assert.equal(emailMessageUsesActiveProviderScope(personalMessage, "my-triage", "user-2", "owner@example.test"), false);
  assert.equal(emailMessageUsesActiveProviderScope(personalMessage, "my-triage", "user-1", "other@example.test"), false);
  assert.equal(emailMessageUsesActiveProviderScope(personalMessage, "primary", "user-1", "owner@example.test"), false);
});

test("collaboration snapshots project stable row identity and source annotations", () => {
  const source = collaboration("collaboration-1", {
    scope_type: "shared",
    shared_inbox_id: " shared-1 ",
    provider_thread_id: " provider-thread-1 ",
    latest_message_id: " latest-message-1 ",
    latest_message: message("   ", { thread_id: "   ", subject: "Latest snapshot" }),
  });

  const projected = emailCollaborationListMessage(source);
  assert.equal(projected?.id, "latest-message-1");
  assert.equal(projected?.thread_id, "provider-thread-1");
  assert.equal(projected?.collaboration_id, "collaboration-1");
  assert.equal(projected?.collaboration_node_id, "node-collaboration-1");
  assert.equal(projected?.collaboration_information_id, "information-collaboration-1");
  assert.equal(projected?.collaboration_shared_inbox_id, "shared-1");
  assert.equal(source.latest_message?.id, "   ");

  assert.equal(emailCollaborationListMessage(collaboration("empty", {
    latest_message: undefined,
    message_snapshot: undefined,
    message: undefined,
  })), null);
});

test("shared collaboration rows stay in a navigable source inbox and otherwise fall back to My Triage", () => {
  const shared = collaboration("shared-collaboration", {
    scope_type: "shared",
    shared_inbox_id: "shared-1",
  });
  const personal = collaboration("personal-collaboration", {
    scope_type: "personal",
    personal_user_id: "user-1",
    account_email: "owner@example.test",
  });

  assert.deepEqual(
    mergeEmailCollaborationsForView([], [shared, personal], "my-triage", new Set(["shared-1"])).map((item) => item.collaboration_id),
    ["personal-collaboration"],
  );
  assert.deepEqual(
    mergeEmailCollaborationsForView([], [shared, personal], "shared:shared-1", new Set(["shared-1"])).map((item) => item.collaboration_id),
    ["shared-collaboration"],
  );
  assert.deepEqual(
    mergeEmailCollaborationsForView([], [shared, personal], "shared:shared-2", new Set(["shared-1", "shared-2"])),
    [],
  );
  assert.deepEqual(
    mergeEmailCollaborationsForView([], [shared], "my-triage", new Set()).map((item) => item.collaboration_id),
    ["shared-collaboration"],
  );
});

test("personal virtual rows never dedupe across account scopes and matching merges stay immutable", () => {
  const provider = message("provider-message", {
    thread_id: "thread-1",
    subject: "Provider subject",
    date: 200,
    from: [{ name: "Provider sender", email: "sender@example.test" }],
  });
  const otherAccount = collaboration("other-account", {
    account_email: "other@example.test",
    latest_message: message("provider-message", {
      thread_id: "thread-1",
      subject: "Other account snapshot",
      date: 100,
    }),
  });

  const crossAccount = mergeEmailCollaborationsForView(
    [provider],
    [otherAccount],
    "my-triage",
    new Set(),
    "owner@example.test",
    "provider-scope",
    "user-1",
  );
  assert.equal(crossAccount.length, 2);
  assert.deepEqual(new Set(crossAccount.map((item) => item.collaboration_id ?? "provider")), new Set(["provider", "other-account"]));
  assert.equal(new Set(crossAccount.map(emailMessageRowKey)).size, 2);
  assert.equal(new Set(crossAccount.map(emailThreadKey)).size, 2);
  assert.equal(condenseEmailThreadMessages(crossAccount).length, 2);

  const matchingAccount = collaboration("matching-account", {
    account_email: " OWNER@Example.Test ",
    latest_message: message("provider-message", {
      thread_id: "thread-1",
      subject: "Stored snapshot subject",
      date: 100,
      from: [{ name: "Snapshot sender", email: "snapshot@example.test" }],
    }),
  });
  const deduped = mergeEmailCollaborationsForView(
    [provider],
    [matchingAccount],
    "my-triage",
    new Set(),
    "owner@example.test",
    "provider-scope",
    "user-1",
  );
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.subject, "Provider subject");
  assert.equal(deduped[0]?.collaboration_id, "matching-account");
  assert.notEqual(deduped[0], provider);
  deduped[0]!.from![0]!.name = "Local mutation";
  assert.equal(provider.from?.[0]?.name, "Provider sender");
  assert.equal(matchingAccount.latest_message?.from?.[0]?.name, "Snapshot sender");
});

test("collaboration matching requires immutable source identity before provider id or thread identity", () => {
  const target = collaboration("owner-source", {
    personal_user_id: "user-1",
    account_email: "owner@example.test",
    latest_message: message("same-message", { thread_id: "same-thread" }),
  });
  const foreign = message("same-message", {
    thread_id: "same-thread",
    collaboration_id: "foreign-source",
    collaboration_personal_user_id: "user-2",
    collaboration_account_email: "other@example.test",
  });
  const activeProvider = message("same-message", { thread_id: "same-thread" });

  assert.equal(emailMessageMatchesCollaboration(foreign, target, "my-triage", "owner@example.test", "user-1"), false);
  assert.equal(emailMessageMatchesCollaboration(activeProvider, target, "my-triage", "owner@example.test", "user-1"), true);
  assert.equal(emailMessageMatchesCollaboration(activeProvider, target, "my-triage", "owner@example.test", "user-2"), false);
});

test("every loaded provider message in a matching source thread receives collaboration identity", () => {
  const source = collaboration("thread-collaboration", {
    personal_user_id: "user-1",
    account_email: "owner@example.test",
    latest_message: message("latest", { thread_id: "same-thread", date: 300 }),
  });
  const merged = mergeEmailCollaborationsForView([
    message("latest", { thread_id: "same-thread", date: 300 }),
    message("older", { thread_id: "same-thread", date: 100 }),
  ], [source], "my-triage", new Set(), "owner@example.test", "provider-scope", "user-1");

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((item) => item.collaboration_id), ["thread-collaboration", "thread-collaboration"]);
  assert.equal(condenseEmailThreadMessages(merged).length, 1);
});

test("shared rows dedupe only against provider messages from the active shared mailbox", () => {
  const provider = message("same-provider-id", {
    thread_id: "same-thread",
    subject: "Provider shared row",
  });
  const active = collaboration("active-shared", {
    shared_inbox_id: "shared-1",
    latest_message: message("same-provider-id", { thread_id: "same-thread", subject: "Stored active row" }),
  });
  const foreign = collaboration("foreign-shared", {
    shared_inbox_id: "shared-2",
    latest_message: message("same-provider-id", { thread_id: "same-thread", subject: "Stored foreign row" }),
  });

  const merged = mergeEmailCollaborationsForView(
    [provider],
    [active, foreign],
    "shared:shared-1",
    new Set(["shared-1", "shared-2"]),
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.collaboration_id, "active-shared");
  assert.equal(merged[0]?.subject, "Provider shared row");
});
