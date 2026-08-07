import test from "node:test";
import assert from "node:assert/strict";
import type {
  CommunicationsEmailCollaboration,
  EmailMessage,
} from "../../../../frontend/src/modules/communications/communicationsApi.js";
import {
  emailCollaborationListMessage,
  emailMessageMatchesCollaboration,
  emailMessageMatchesNodeAttachment,
  emailMessageUsesActiveProviderScope,
  mergeEmailCollaborationsForView,
  mergeEmailMessageWithNodeAttachment,
  sharedInboxIDForHomeView,
} from "../../../../frontend/src/pages/home/emailCollaborationRows.js";
import {
  condenseEmailThreadMessages,
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

test("collaboration snapshots never manufacture My Triage or Shared Triage rows", () => {
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
    [],
  );
  assert.deepEqual(
    mergeEmailCollaborationsForView([], [shared, personal], "shared:shared-1", new Set(["shared-1"])).map((item) => item.collaboration_id),
    [],
  );
  assert.deepEqual(
    mergeEmailCollaborationsForView(
      [],
      [shared, personal],
      "my-triage",
      new Set(["shared-1"]),
      "owner@example.test",
      "provider-scope",
      "user-1",
    ),
    [],
  );
  assert.deepEqual(
    mergeEmailCollaborationsForView([], [shared, personal], "shared:shared-2", new Set(["shared-1", "shared-2"])),
    [],
  );
  assert.deepEqual(
    mergeEmailCollaborationsForView([], [shared], "my-triage", new Set()).map((item) => item.collaboration_id),
    [],
  );
});

test("foreign collaboration snapshots stay out while matching provider rows gain immutable annotations", () => {
  const provider = message("provider-message", {
    thread_id: "thread-1",
    subject: "Provider subject",
    date: 200,
    from: [{ name: "Provider sender", email: "sender@example.test" }],
    collaboration_id: undefined,
    collaboration_node_id: undefined,
  });
  const otherAccount = collaboration("other-account", {
    account_email: "other@example.test",
    personal_user_id: "user-2",
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
  assert.equal(crossAccount.length, 1);
  assert.equal(crossAccount[0]?.collaboration_id, undefined);
  assert.equal(condenseEmailThreadMessages(crossAccount).length, 1);

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
  assert.equal(deduped[0]?.collaboration_node_id, "node-matching-account");
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

test("direct existing-node attachment annotates the selected message and every loaded thread reply", () => {
  const attachment = {
    nodeID: " node-direct ",
    messageID: "message-1",
    threadID: "thread-1",
    informationID: " information-direct ",
    logicGateIDs: [" gate-1 ", "gate-2"],
  };
  const selected = message("message-1", { thread_id: "thread-1" });
  const reply = message("message-2", { thread_id: "thread-1" });
  const unrelated = message("message-3", { thread_id: "thread-2" });

  assert.equal(emailMessageMatchesNodeAttachment(selected, attachment), true);
  assert.equal(emailMessageMatchesNodeAttachment(reply, attachment), true);
  assert.equal(emailMessageMatchesNodeAttachment(unrelated, attachment), false);

  const merged = mergeEmailMessageWithNodeAttachment(reply, attachment);
  assert.equal(merged.collaboration_node_id, "node-direct");
  assert.equal(merged.collaboration_information_id, "information-direct");
  assert.deepEqual(merged.logic_gate_ids, ["gate-1", "gate-2"]);
  assert.equal(merged.logic_gate_count, 2);
  assert.equal(reply.collaboration_node_id, undefined);
  assert.equal(mergeEmailMessageWithNodeAttachment(unrelated, { ...attachment, nodeID: " " }), unrelated);
});
