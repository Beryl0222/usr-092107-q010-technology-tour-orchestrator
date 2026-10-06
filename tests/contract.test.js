import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateEvent } from "../src/validator.js";

test("样例符合领域约定", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));
  assert.deepEqual(validateEvent(sample), []);
});

test("场景中的每条事件都符合信封与搭配约定", async () => {
  const scenario = JSON.parse(await readFile(new URL("../data/scenario.json", import.meta.url), "utf8"));
  for (const event of scenario.events) {
    assert.deepEqual(validateEvent(event), [], `${event.event_id} 应通过校验`);
  }
});

test("事件类型必须挂在对应聚合上", () => {
  const wrong = {
    event_id: "x-1",
    event_type: "PAYMENT_SETTLED",
    aggregate_type: "demo_slot",
    aggregate_id: "S1",
    occurred_at: "2026-10-06T08:00:00+08:00",
    version: 1,
    summary: "聚合挂错的事件",
    payload: { order_id: "ORDER-1" },
  };
  assert.ok(validateEvent(wrong).some((e) => e.includes("payment_order")));
});
