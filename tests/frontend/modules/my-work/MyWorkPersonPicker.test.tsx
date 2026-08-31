import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act, useState } from "react";
import { Simulate } from "react-dom/test-utils";
import type { BoundRequestJSON } from "../../../../frontend/src/modules/api/requestJSON.js";
import type { MyWorkResponse } from "../../../../frontend/src/modules/my-work/myWorkApi.js";
import {
  buildMyWorkPersonDirectoryRows,
  fetchMyWorkPersonDirectory,
  MyWorkPersonPicker,
  type MyWorkPersonDirectory,
  type MyWorkPersonSelection,
} from "../../../../frontend/src/modules/my-work/MyWorkPersonPicker.js";
import { assertMyWorkResponseScope, useMyWorkData } from "../../../../frontend/src/modules/my-work/useMyWorkData.js";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

function installDOMGlobals(dom: JSDOM, restores: Restore[]) {
  for (const name of [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement",
    "HTMLInputElement", "SVGElement", "Event", "EventTarget", "MouseEvent", "KeyboardEvent", "FocusEvent",
    "CustomEvent", "MutationObserver", "PointerEvent",
  ] as const) {
    const value = name === "window" || name === "self"
      ? dom.window
      : name === "document"
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  const inputPrototype = dom.window.HTMLElement.prototype as unknown as {
    attachEvent?: () => void;
    detachEvent?: () => void;
  };
  const attachEvent = inputPrototype.attachEvent;
  const detachEvent = inputPrototype.detachEvent;
  inputPrototype.attachEvent = () => undefined;
  inputPrototype.detachEvent = () => undefined;
  restores.push(() => {
    if (attachEvent) inputPrototype.attachEvent = attachEvent;
    else delete inputPrototype.attachEvent;
    if (detachEvent) inputPrototype.detachEvent = detachEvent;
    else delete inputPrototype.detachEvent;
  });
  installGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window), restores);
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);
}

async function flushDOM(milliseconds = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  });
}

function directory(companyID = "company-1"): MyWorkPersonDirectory {
  return {
    users: [
      { company_id: companyID, user_id: "viewer-1", display_name: "Viewer One", email: "viewer@example.com" },
      { company_id: companyID, user_id: "person-ada", display_name: "Ada Lovelace", email: "ada@example.com" },
      { company_id: companyID, user_id: "person-multi", display_name: "Morgan Multi", email: "morgan@example.com" },
      { company_id: companyID, user_id: "person-none", display_name: "Nora No Team", email: "nora@example.com" },
      { company_id: companyID, user_id: "person-orphan", display_name: "Owen Orphan", email: "owen@example.com" },
    ],
    groups: [
      { company_id: companyID, group_id: "engineering", name: "Engineering", position: 1 },
      { company_id: companyID, group_id: "platform", parent_group_id: "engineering", name: "Platform", position: 1 },
      { company_id: companyID, group_id: "sales", name: "Sales", position: 2 },
    ],
    members: [
      { company_id: companyID, group_id: "engineering", user_id: "viewer-1" },
      { company_id: companyID, group_id: "platform", user_id: "person-ada" },
      { company_id: companyID, group_id: "platform", user_id: "person-multi" },
      { company_id: companyID, group_id: "sales", user_id: "person-multi" },
      { company_id: companyID, group_id: "missing-team", user_id: "person-orphan" },
      { company_id: companyID, group_id: "engineering", user_id: "missing-user", user_display_name: "Ghost Member" },
    ],
  };
}

function emptyMyWorkResponse(userID: string, projectName = ""): MyWorkResponse {
  return {
    company_id: "company-1",
    user_id: userID,
    action_items: { perspective: "mine", items: [], has_more: false },
    nodes: { role: "responsible", items: [], has_more: false },
    processes: { role: "responsible", items: [], has_more: false },
    projects: {
      items: projectName ? [{ project_id: `project-${userID}`, name: projectName }] : [],
      has_more: false,
    },
  };
}

test("My Work people rows preserve nested teams, multiple teams, and an authoritative no-team group", () => {
  const rows = buildMyWorkPersonDirectoryRows(directory());
  assert.deepEqual(rows.map((row) => [row.kind, row.label, row.depth]), [
    ["group", "Engineering", 0],
    ["group", "Platform", 1],
    ["user", "Ada Lovelace", 2],
    ["user", "Morgan Multi", 2],
    ["user", "Viewer One", 1],
    ["group", "Sales", 0],
    ["user", "Morgan Multi", 1],
    ["group", "No team", 0],
    ["user", "Nora No Team", 1],
    ["user", "Owen Orphan", 1],
  ]);
  assert.equal(rows.some((row) => row.kind === "user" && row.label === "Ghost Member"), false);
  assert.equal(rows.filter((row) => row.kind === "user" && row.userID === "person-multi").length, 2);

  assert.deepEqual(buildMyWorkPersonDirectoryRows(directory(), "ada").map((row) => row.label), [
    "Engineering",
    "Platform",
    "Ada Lovelace",
  ]);
  assert.deepEqual(buildMyWorkPersonDirectoryRows(directory(), "morgan@example.com").map((row) => row.label), [
    "Engineering",
    "Platform",
    "Morgan Multi",
    "Sales",
    "Morgan Multi",
  ]);
});

test("My Work directory rejects rows from another company", async () => {
  const requestJSON: BoundRequestJSON = async <T,>(path: string): Promise<T> => {
    if (path.endsWith("/users")) return { users: directory("other-company").users } as T;
    return { groups: [], members: [] } as T;
  };
  await assert.rejects(fetchMyWorkPersonDirectory(requestJSON, "company-1"), /scope did not match/);
});

test("My Work people control is beside its search, supports keyboard selection, self reset, and Escape focus restore", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/my-work",
  });
  const restores: Restore[] = [];
  installDOMGlobals(dom, restores);
  let mountedRoot: { unmount(): void } | null = null;
  try {
    const { createRoot } = await import("react-dom/client");
    const calls: string[] = [];
    const selections: MyWorkPersonSelection[] = [];
    const requestJSON: BoundRequestJSON = async <T,>(path: string): Promise<T> => {
      calls.push(path);
      const data = directory();
      if (path.endsWith("/users")) return { users: data.users } as T;
      return { groups: data.groups, members: data.members } as T;
    };
    function Harness() {
      const [selection, setSelection] = useState<MyWorkPersonSelection>({ userID: "viewer-1", label: "Viewer One" });
      return (
        <MyWorkPersonPicker
          companyID="company-1"
          viewerUserID="viewer-1"
          selectedUserID={selection.userID}
          requestJSON={requestJSON}
          onSelect={(next) => {
            selections.push(next);
            setSelection(next);
          }}
        />
      );
    }

    const container = dom.window.document.getElementById("root") as HTMLElement;
    mountedRoot = createRoot(container);
    await act(async () => mountedRoot?.render(<Harness />));
    const cluster = container.querySelector<HTMLElement>("[data-my-work-header-search=people]");
    const input = cluster?.querySelector<HTMLInputElement>("input[role=combobox]");
    const peopleButton = cluster?.querySelector<HTMLButtonElement>("[data-my-work-people-button=true]");
    assert.ok(cluster && input && peopleButton);
    assert.equal(cluster.lastElementChild, peopleButton, "the people icon sits directly beside the people search");
    assert.equal(calls.length, 0, "the directory stays lazy until the picker opens");

    await act(async () => peopleButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    await flushDOM(20);
    assert.equal(calls.length, 2);
    assert.equal(dom.window.document.activeElement, input);
    assert.ok(dom.window.document.querySelector("[data-my-work-person-team=engineering]"));
    assert.ok(dom.window.document.querySelector("[data-my-work-person-team=platform][data-my-work-person-depth='1']"));

    await act(async () => Simulate.keyDown(input, { key: "End" }));
    const lastOptionID = input.getAttribute("aria-activedescendant");
    assert.ok(lastOptionID && lastOptionID !== "my-work-person-option-self");
    await act(async () => Simulate.keyDown(input, { key: "Home" }));
    assert.equal(input.getAttribute("aria-activedescendant"), "my-work-person-option-self");
    await act(async () => Simulate.keyDown(input, { key: "ArrowDown" }));
    assert.notEqual(input.getAttribute("aria-activedescendant"), "my-work-person-option-self");

    input.value = "Ada";
    await act(async () => Simulate.change(input));
    await flushDOM();
    assert.match(input.getAttribute("aria-activedescendant") ?? "", /my-work-person-option/);
    await act(async () => Simulate.keyDown(input, { key: "Enter" }));
    await flushDOM(20);
    assert.deepEqual(selections.at(-1), { userID: "person-ada", label: "Ada Lovelace" });
    assert.equal(dom.window.document.activeElement, peopleButton);
    assert.match(container.textContent ?? "", /Viewing Ada Lovelace/);

    await act(async () => peopleButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    await flushDOM(20);
    const selfOption = dom.window.document.getElementById("my-work-person-option-self") as HTMLButtonElement;
    assert.ok(selfOption);
    await act(async () => selfOption.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    await flushDOM(20);
    assert.equal(selections.at(-1)?.userID, "viewer-1");
    assert.match(container.textContent ?? "", /My Work \(You\)/);

    await act(async () => peopleButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    await flushDOM(20);
    await act(async () => dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await flushDOM(20);
    assert.equal(input.getAttribute("aria-expanded"), "false");
    assert.equal(dom.window.document.activeElement, peopleButton);
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});

test("My Work directory results cannot cross an auth-session request boundary", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/my-work",
  });
  const restores: Restore[] = [];
  installDOMGlobals(dom, restores);
  let mountedRoot: { unmount(): void } | null = null;
  try {
    const { createRoot } = await import("react-dom/client");
    const oldResolvers: Array<(value: unknown) => void> = [];
    const oldRequest: BoundRequestJSON = <T,>(path: string): Promise<T> => new Promise<T>((resolve) => {
      oldResolvers.push((value) => resolve(value as T));
    });
    const newRequest: BoundRequestJSON = async <T,>(path: string): Promise<T> => {
      if (path.endsWith("/users")) {
        return { users: [{ company_id: "company-1", user_id: "viewer-2", display_name: "Fresh Session" }] } as T;
      }
      return { groups: [], members: [] } as T;
    };
    const container = dom.window.document.getElementById("root") as HTMLElement;
    mountedRoot = createRoot(container);
    await act(async () => mountedRoot?.render(
      <MyWorkPersonPicker companyID="company-1" viewerUserID="viewer-1" selectedUserID="viewer-1" requestJSON={oldRequest} onSelect={() => undefined} />,
    ));
    let button = container.querySelector<HTMLButtonElement>("[data-my-work-people-button=true]") as HTMLButtonElement;
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    await flushDOM();
    assert.equal(oldResolvers.length, 2);

    await act(async () => mountedRoot?.render(
      <MyWorkPersonPicker companyID="company-1" viewerUserID="viewer-2" selectedUserID="viewer-2" requestJSON={newRequest} onSelect={() => undefined} />,
    ));
    await flushDOM();
    button = container.querySelector<HTMLButtonElement>("[data-my-work-people-button=true]") as HTMLButtonElement;
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    await flushDOM(100);
    assert.match(dom.window.document.body.textContent ?? "", /Fresh Session/);

    const oldData = directory();
    await act(async () => {
      oldResolvers[0]?.({ users: oldData.users });
      oldResolvers[1]?.({ groups: oldData.groups, members: oldData.members });
    });
    await flushDOM();
    assert.doesNotMatch(dom.window.document.body.textContent ?? "", /Ada Lovelace/);
    assert.match(dom.window.document.body.textContent ?? "", /Fresh Session/);
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});

test("My Work ignores a late prior-subject response and validates the applied response scope", async () => {
  assert.doesNotThrow(() => assertMyWorkResponseScope({ company_id: "company-1", user_id: "person-b" }, "company-1", "person-b"));
  assert.throws(
    () => assertMyWorkResponseScope({ company_id: "company-1", user_id: "person-a" }, "company-1", "person-b"),
    /subject scope did not match/,
  );
  assert.throws(
    () => assertMyWorkResponseScope({ company_id: "company-2", user_id: "person-b" }, "company-1", "person-b"),
    /company scope did not match/,
  );

  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/my-work",
  });
  const restores: Restore[] = [];
  installDOMGlobals(dom, restores);
  let mountedRoot: { unmount(): void } | null = null;
  try {
    const { createRoot } = await import("react-dom/client");
    const resolvers = new Map<string, (response: MyWorkResponse) => void>();
    const renderSnapshots: Array<{ subjectUserID: string; projects: string }> = [];
    const requestJSON: BoundRequestJSON = <T,>(path: string): Promise<T> => {
      const subject = new URL(path, "http://api.test").searchParams.get("subject_user_id") ?? "viewer-1";
      return new Promise<T>((resolve) => resolvers.set(subject, (value) => resolve(value as T)));
    };
    function DataHarness({
      subjectUserID,
      boundRequestJSON = requestJSON,
    }: {
      subjectUserID: string;
      boundRequestJSON?: BoundRequestJSON;
    }) {
      const { state } = useMyWorkData("company-1", "viewer-1", subjectUserID, boundRequestJSON);
      const projects = state.projects.items.map((item) => item.name).join(",");
      renderSnapshots.push({ subjectUserID, projects });
      return <div data-projects={projects} data-error={state.projects.error} />;
    }

    const container = dom.window.document.getElementById("root") as HTMLElement;
    mountedRoot = createRoot(container);
    await act(async () => mountedRoot?.render(<DataHarness subjectUserID="person-a" />));
    await flushDOM();
    assert.ok(resolvers.has("person-a"));
    await act(async () => resolvers.get("person-a")?.(emptyMyWorkResponse("person-a", "First Project")));
    await flushDOM();
    assert.equal(container.firstElementChild?.getAttribute("data-projects"), "First Project");

    renderSnapshots.length = 0;
    await act(async () => mountedRoot?.render(<DataHarness subjectUserID="person-b" />));
    await flushDOM();
    assert.ok(resolvers.has("person-b"));
    assert.equal(
      renderSnapshots.some((snapshot) => snapshot.subjectUserID === "person-b" && snapshot.projects === "First Project"),
      false,
      "a new subject is never rendered with the prior subject's rows, even before effects settle",
    );

    await act(async () => mountedRoot?.render(<DataHarness subjectUserID="person-c" />));
    await flushDOM();
    assert.ok(resolvers.has("person-c"));

    await act(async () => resolvers.get("person-c")?.(emptyMyWorkResponse("person-c", "Fresh Project")));
    await flushDOM();
    assert.equal(container.firstElementChild?.getAttribute("data-projects"), "Fresh Project");
    await act(async () => resolvers.get("person-b")?.(emptyMyWorkResponse("person-b", "Stale Project")));
    await flushDOM();
    assert.equal(container.firstElementChild?.getAttribute("data-projects"), "Fresh Project");
    assert.equal(container.firstElementChild?.getAttribute("data-error"), "");

    let resolveNewSession: ((response: MyWorkResponse) => void) | undefined;
    const newSessionRequest: BoundRequestJSON = <T,>(): Promise<T> => new Promise<T>((resolve) => {
      resolveNewSession = (value) => resolve(value as T);
    });
    renderSnapshots.length = 0;
    await act(async () => mountedRoot?.render(
      <DataHarness subjectUserID="person-c" boundRequestJSON={newSessionRequest} />,
    ));
    await flushDOM();
    assert.equal(
      renderSnapshots.some((snapshot) => snapshot.subjectUserID === "person-c" && snapshot.projects === "Fresh Project"),
      false,
      "a replacement auth-session request function synchronously hides prior-session rows",
    );
    await act(async () => resolveNewSession?.(emptyMyWorkResponse("person-c", "New Session Project")));
    await flushDOM();
    assert.equal(container.firstElementChild?.getAttribute("data-projects"), "New Session Project");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});
