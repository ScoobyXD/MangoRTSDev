import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySidebarPinLayout,
  createSidebarPin,
  createSidebarPinFolder,
  deleteSidebarPin,
  deleteSidebarPinFolder,
  fetchSidebarPinTree,
  groupSidebarPins,
  renameSidebarPinFolder,
} from "../../../frontend/src/app/sidebarPinsApi.js";

type CapturedRequest = { url: string; method: string; body: string };

const PIN_RECORD = {
  pin_id: "pin-1",
  company_id: "company-1",
  user_id: "user-1",
  parent_folder_id: "folder-1",
  resource_type: "node",
  resource_id: "node-1",
  name: "Node One",
  position: 1000,
  created_timestamp: "2026-08-05T12:00:00Z",
};

const FOLDER_RECORD = {
  folder_id: "folder-1",
  company_id: "company-1",
  user_id: "user-1",
  parent_folder_id: null,
  name: "New Folder",
  position: 1000,
  created_timestamp: "2026-08-05T12:00:00Z",
  updated_timestamp: "2026-08-05T12:00:00Z",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function createTrackingStorage(touchedKeys: string[]): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key: string) { touchedKeys.push(key); return values.get(key) ?? null; },
    key(index: number) { return Array.from(values.keys())[index] ?? null; },
    removeItem(key: string) { touchedKeys.push(key); values.delete(key); },
    setItem(key: string, value: string) { touchedKeys.push(key); values.set(key, value); },
  } as Storage;
}

function installGlobal<T extends "fetch" | "localStorage" | "sessionStorage">(name: T, value: typeof globalThis[T]): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete (globalThis as Record<string, unknown>)[name];
  };
}

describe("sidebarPinsApi", () => {
  it("uses only the canonical DB-backed pin tree APIs and never browser storage", async () => {
    const requests: CapturedRequest[] = [];
    const touchedStorageKeys: string[] = [];
    const restoreLocalStorage = installGlobal("localStorage", createTrackingStorage(touchedStorageKeys));
    const restoreSessionStorage = installGlobal("sessionStorage", createTrackingStorage(touchedStorageKeys));
    const restoreFetch = installGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? init.body : "";
      requests.push({ url, method, body });
      if (method === "GET" && url.endsWith("/v1/user-pins?company_id=company-1")) return jsonResponse({ pin_folders: [FOLDER_RECORD], user_pins: [PIN_RECORD] });
      if (method === "POST" && url.endsWith("/v1/user-pins")) return jsonResponse(PIN_RECORD);
      if (method === "DELETE" && url.includes("/v1/user-pins/pin-1")) return jsonResponse({ deleted: true });
      if (method === "POST" && url.endsWith("/v1/user-pin-folders")) return jsonResponse(FOLDER_RECORD);
      if (method === "PUT" && url.endsWith("/v1/user-pin-folders/folder-1")) return jsonResponse({ ...FOLDER_RECORD, name: "Renamed" });
      if (method === "DELETE" && url.includes("/v1/user-pin-folders/folder-1")) return jsonResponse({ pin_folders: [], user_pins: [] });
      if (method === "PUT" && url.endsWith("/v1/user-pins/layout")) return jsonResponse({ pin_folders: [FOLDER_RECORD], user_pins: [PIN_RECORD] });
      if (method === "POST" && url.endsWith("/v1/user-pin-folders/group")) return jsonResponse({ grouped_folder: FOLDER_RECORD, pin_folders: [FOLDER_RECORD], user_pins: [PIN_RECORD] });
      throw new Error(`unexpected sidebar pin request: ${method} ${url}`);
    }) as typeof fetch);

    try {
      const fetched = await fetchSidebarPinTree("https://api.example.test", "company-1");
      const created = await createSidebarPin("https://api.example.test", "company-1", { kind: "node", id: "node-1", parentFolderID: "folder-1" });
      await deleteSidebarPin("https://api.example.test", "company-1", "pin-1");
      const folder = await createSidebarPinFolder("https://api.example.test", "company-1", "", "New Folder");
      const renamed = await renameSidebarPinFolder("https://api.example.test", "company-1", "folder-1", "Renamed");
      const layout = await applySidebarPinLayout("https://api.example.test", "company-1", [{ entryType: "pin", entryID: "pin-1", parentFolderID: "folder-1", position: 1000 }]);
      const grouped = await groupSidebarPins("https://api.example.test", "company-1", "pin-1", "pin-2");
      const deleted = await deleteSidebarPinFolder("https://api.example.test", "company-1", "folder-1");

      assert.equal(fetched.folders[0]?.folderID, "folder-1");
      assert.equal(created.parentFolderID, "folder-1");
      assert.equal(folder.name, "New Folder");
      assert.equal(renamed.name, "Renamed");
      assert.equal(layout.pins[0]?.pinID, "pin-1");
      assert.equal(grouped.folder.folderID, "folder-1");
      assert.deepEqual(deleted, { folders: [], pins: [] });
      assert.equal(requests.some((request) => request.url.includes("/v1/user-pins/order")), false);
      assert.deepEqual(JSON.parse(requests.find((request) => request.method === "POST" && request.url.endsWith("/v1/user-pins"))?.body ?? "{}"), {
        company_id: "company-1",
        resource_type: "node",
        resource_id: "node-1",
        parent_folder_id: "folder-1",
      });
      assert.equal(touchedStorageKeys.some((key) => /pin/i.test(key)), false);
    } finally {
      restoreFetch();
      restoreSessionStorage();
      restoreLocalStorage();
    }
  });
});
