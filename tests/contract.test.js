import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateEvent } from "../src/validator.js";

const load = (name) => readFile(new URL(`../data/${name}`, import.meta.url), "utf8").then(JSON.parse);

const base = {
  event_id: "evt-test-1",
  event_type: "SLOT_HELD",
  aggregate_type: "demo_slot",
  aggregate_id: "slot-1",
  occurred_at: "2026-10-06T09:00:00+08:00",
  version: 1,
  summary: "测试事件",
};

test("样例符合领域约定", async () => {
  assert.deepEqual(validateEvent(await load("sample.json")), []);
});

test("行程修订样例带多语种原因且通过校验", async () => {
  const event = await load("sample-itinerary-revised.json");
  assert.deepEqual(validateEvent(event), []);
  assert.ok(Object.keys(event.payload.reason_i18n).length >= 2);
});

test("拒绝未知事件类型与聚合不匹配", () => {
  assert.ok(validateEvent({ ...base, event_type: "NOPE" }).some((e) => e.includes("未知事件类型")));
  assert.ok(validateEvent({ ...base, aggregate_type: "visitor_group" }).some((e) => e.includes("应挂在聚合")));
});

test("受限区域必须本人签署，领队代签被拒绝", () => {
  const proxy = {
    ...base,
    event_type: "RESTRICTED_AREA_SIGNED",
    aggregate_type: "access_clearance",
    payload: { member_id: "member-01", signer_id: "tour-leader", zone_id: "rnd-3f" },
  };
  assert.ok(validateEvent(proxy).some((e) => e.includes("本人逐一签署")));

  const self = { ...proxy, payload: { ...proxy.payload, signer_id: "member-01" } };
  assert.deepEqual(validateEvent(self), []);
});

test("行程修订必须携带多语种变更原因", () => {
  const revised = { ...base, event_type: "ITINERARY_REVISED", aggregate_type: "itinerary_revision" };
  assert.ok(validateEvent(revised).some((e) => e.includes("reason_i18n")));
});

test("合作方回执必须指向原事件以便幂等去重", () => {
  const receipt = { ...base, event_type: "PARTNER_RECEIPT_RECORDED", aggregate_type: "partner_receipt", payload: {} };
  assert.ok(validateEvent(receipt).some((e) => e.includes("receipt_of")));

  const ok = { ...receipt, payload: { receipt_of: "evt-origin-1", partner_id: "uav-operator", status: "accepted" } };
  assert.deepEqual(validateEvent(ok), []);
});
