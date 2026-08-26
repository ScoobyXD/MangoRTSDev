import assert from "node:assert/strict";
import test from "node:test";
import {
  clearQDRatingsCache,
  getQDBusinessDate,
  loadQDRatings,
  millisecondsUntilNextQDBusinessDay,
  readQDRatingsSnapshot,
  setQDRating,
  subscribeQDRatings,
  type QDRating,
} from "../../../../frontend/src/modules/logic-gates/qdRatingsApi.js";

const rating = (overrides: Partial<QDRating> = {}): QDRating => ({
  company_id: "company-1",
  qd_rating_id: "rating-1",
  logic_gate_id: "gate-1",
  quality_rating: "green",
  delivery_rating: null,
  rated_by_user_id: "user-1",
  rated_by_display_name: "Avery Stone",
  rated_created_timestamp: "2026-08-25T19:00:00Z",
  rated_updated_timestamp: "2026-08-25T19:00:00Z",
  ...overrides,
});

test("Q/D business dates use the fixed Los Angeles day", () => {
  assert.deepEqual(getQDBusinessDate(new Date("2026-08-25T06:59:59Z")), {
    year: 2026,
    month: 8,
    day: 24,
    monthKey: "2026-08",
    dateKey: "2026-08-24",
  });
  assert.equal(getQDBusinessDate(new Date("2026-08-25T07:00:00Z")).dateKey, "2026-08-25");
  assert.equal(millisecondsUntilNextQDBusinessDay(new Date("2026-08-25T06:59:59Z")), 2_000);
});

test("Q/D reads share one request and committed writes reconcile every subscriber", async () => {
  clearQDRatingsCache();
  let getCount = 0;
  const requests: Array<{ path: string; method: string; json?: unknown }> = [];
  let committed: QDRating | null = rating();
  const requestJSON = async <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    const method = init?.method ?? "GET";
    requests.push({ path, method, json: init?.json });
    if (method === "GET") {
      getCount += 1;
      await Promise.resolve();
      return { qd_ratings: [] } as T;
    }
    return { qd_rating: committed } as T;
  };
  const input = {
    apiBase: "http://localhost:8080",
    companyID: "company-1",
    logicGateID: "gate-1",
    month: "2026-08",
    requestJSON,
  };
  let notifications = 0;
  const unsubscribe = subscribeQDRatings(input.apiBase, input.companyID, input.logicGateID, input.month, () => { notifications += 1; });

  await Promise.all([loadQDRatings(input), loadQDRatings(input)]);
  assert.equal(getCount, 1);
  assert.equal(readQDRatingsSnapshot(input.apiBase, input.companyID, input.logicGateID, input.month).ratings.length, 0);

  await setQDRating({
    apiBase: input.apiBase,
    companyID: input.companyID,
    logicGateID: input.logicGateID,
    metric: "quality",
    rating: "green",
    requestJSON,
  });
  assert.deepEqual(requests[requests.length - 1], {
    path: "/v1/logic-gates/gate-1/qd-ratings/quality",
    method: "PUT",
    json: { company_id: "company-1", rating: "green" },
  });
  assert.equal(readQDRatingsSnapshot(input.apiBase, input.companyID, input.logicGateID, input.month).ratings[0]?.rated_by_display_name, "Avery Stone");

  committed = null;
  await setQDRating({
    apiBase: input.apiBase,
    companyID: input.companyID,
    logicGateID: input.logicGateID,
    metric: "quality",
    rating: null,
    requestJSON,
    now: new Date("2026-08-25T20:00:00Z"),
  });
  assert.equal(readQDRatingsSnapshot(input.apiBase, input.companyID, input.logicGateID, input.month).ratings.length, 0);
  assert.ok(notifications >= 4, "loading and both committed writes should notify mounted views");
  unsubscribe();
});

test("an older Q/D read cannot erase a newer committed choice", async () => {
  clearQDRatingsCache();
  let finishRead: ((value: { qd_ratings: QDRating[] }) => void) | undefined;
  const requestJSON = <T,>(_path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    if ((init?.method ?? "GET") === "PUT") return Promise.resolve({ qd_rating: rating() } as T);
    return new Promise<T>((resolve) => { finishRead = resolve as (value: { qd_ratings: QDRating[] }) => void; });
  };
  const load = loadQDRatings({ apiBase: "", companyID: "company-1", logicGateID: "gate-1", month: "2026-08", requestJSON });
  await setQDRating({ apiBase: "", companyID: "company-1", logicGateID: "gate-1", metric: "quality", rating: "green", requestJSON });
  finishRead?.({ qd_ratings: [] });
  await load;
  assert.equal(readQDRatingsSnapshot("", "company-1", "gate-1", "2026-08").ratings[0]?.quality_rating, "green");
});

test("Q/D cache is discarded after its final mounted tracker leaves", async () => {
  clearQDRatingsCache();
  let getCount = 0;
  const requestJSON = async <T,>(): Promise<T> => {
    getCount += 1;
    return { qd_ratings: [rating()] } as T;
  };
  const input = {
    apiBase: "http://localhost:8080",
    companyID: "company-1",
    logicGateID: "gate-1",
    month: "2026-08",
    requestJSON,
  };

  const firstUnmount = subscribeQDRatings(input.apiBase, input.companyID, input.logicGateID, input.month, () => undefined);
  await loadQDRatings(input);
  firstUnmount();

  const secondUnmount = subscribeQDRatings(input.apiBase, input.companyID, input.logicGateID, input.month, () => undefined);
  await loadQDRatings(input);
  secondUnmount();
  assert.equal(getCount, 2, "reopening after an unmounted gap must read canonical ratings again");
});
