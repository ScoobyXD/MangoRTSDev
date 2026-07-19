declare module "node:test";
declare module "node:assert/strict";
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string, options: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean }>;
}
declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
}
declare const process: {
  cwd(): string;
};

declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string });
    window: Window & { close(): void };
  }
}

declare module "fake-indexeddb" {
  export const indexedDB: IDBFactory;
  export const IDBKeyRange: typeof globalThis.IDBKeyRange;
  export const IDBObjectStore: typeof globalThis.IDBObjectStore;
}
