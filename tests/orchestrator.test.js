import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyAll,
  applyEvent,
  createState,
  evaluateStop,
  nextExecutableStop,
  replan,
} from "../src/orchestrator.js";
import { validateEvent } from "../src/validator.js";

let seq = 0;
function mk(event_type, payload, occurred_at = "2026-10-06T08:00:00+08:00") {
  const aggregateOf = {
    GROUP_PROFILED: "visitor_group",
    SLOT_HELD: "demo_slot",
    SLOT_PERMITTED: "demo_slot",
    DEMO_INTERRUPTED: "demo_slot",
    SAFETY_BRIEFED: "access_clearance",
    ACCESS_CLEARED: "access_clearance",
    FILMING_DECIDED: "access_clearance",
    PAYMENT_SETTLED: "payment_order",
    PICKUP_COMPLETED: "pickup_task",
    RECEIPT_RECORDED: "partner_receipt",
    FALLBACK_ACTIVATED: "itinerary_revision",
    ITINERARY_REVISED: "itinerary_revision",
  };
  seq += 1;
  return {
    event_id: `t-${seq}`,
    event_type,
    aggregate_type: aggregateOf[event_type],
    aggregate_id: payload.slot_id ?? payload.zone_id ?? payload.order_id ?? payload.partner ?? "grp",
    occurred_at,
    version: 1,
    summary: "测试事件",
    payload,
  };
}

function baseGroup() {
  return {
    size: 3,
    languages: ["en", "zh"],
    interests: ["robotics", "drones"],
    member_ids: ["M1", "M2", "M3"],
    leader_id: "L1",
    payment_order_id: "ORDER-1",
    origin_venue_id: "hotel",
    transfers: { "hotel>av_park": 30, "av_park>lab": 10, "lab>mall": 15, "av_park>mall": 90 },
    stops: [
      { stop_id: "A", kind: "demo", venue_id: "av_park", start: "2026-10-06T09:00:00+08:00", end: "2026-10-06T10:00:00+08:00", slot_id: "S1", requires_permit: true },
      { stop_id: "B", kind: "visit", venue_id: "lab", start: "2026-10-06T10:30:00+08:00", end: "2026-10-06T11:30:00+08:00", zone_id: "Z1" },
      { stop_id: "C", kind: "shopping", venue_id: "mall", start: "2026-10-06T12:00:00+08:00", end: "2026-10-06T13:00:00+08:00", requires_payment: "ORDER-1" },
    ],
    alternatives: [
      { alt_id: "ALT-BIG", title: "机器人工作坊", venue_id: "lab", kinds: ["demo"], interests: ["robotics"], languages: ["en"], capacity: 30, duration_min: 60 },
      { alt_id: "ALT-SMALL", title: "无人机模拟器", venue_id: "lab", kinds: ["demo"], interests: ["drones"], languages: ["en"], capacity: 2, duration_min: 60 },
    ],
  };
}

function stateWith(...events) {
  const state = createState();
  applyAll(state, events);
  return state;
}

test("合作方回执按 partner+external_ref 幂等，重复回执不改状态", () => {
  const state = createState();
  const receipt = mk("RECEIPT_RECORDED", { partner: "store", external_ref: "R1", kind: "pickup_ready", ref: "P1" });
  assert.deepEqual(applyEvent(state, receipt), {});
  const again = applyEvent(state, mk("RECEIPT_RECORDED", { partner: "store", external_ref: "R1", kind: "pickup_ready", ref: "P1" }));
  assert.equal(again.duplicate, true);
  assert.equal(state.receipts.size, 1);
  assert.equal(state.receipts.get("store|R1").duplicates, 1);
});

test("受限区域必须本人签署，领队代签被拒绝", () => {
  const bad = mk("ACCESS_CLEARED", { member_id: "M1", zone_id: "Z1", signer_id: "L1" });
  assert.ok(validateEvent(bad).some((e) => e.includes("本人")));
  const state = stateWith(mk("GROUP_PROFILED", baseGroup()));
  const result = applyEvent(state, bad);
  assert.ok(result.rejected);
  assert.equal(state.clearances.size, 0);
});

test("预约只是占位：自动驾驶与低空项目以当日许可为准", () => {
  const group = baseGroup();
  const state = stateWith(
    mk("GROUP_PROFILED", group),
    mk("SLOT_HELD", { slot_id: "S1", refund_policy: { free_cancel_before_min: 120, penalty_pct: 50 } }),
  );
  const stop = group.stops[0];
  // 只有占位、没有当日许可 → 不可执行
  assert.deepEqual(evaluateStop(state, stop, "2026-10-06T08:00:00+08:00").reasons, ["permit_pending"]);
  // 许可日期不是当天 → 仍不可执行
  applyEvent(state, mk("SLOT_PERMITTED", { slot_id: "S1", valid_date: "2026-10-07" }));
  assert.equal(evaluateStop(state, stop, "2026-10-06T08:00:00+08:00").ok, false);
  // 当日许可下达 → 可执行
  applyEvent(state, mk("SLOT_PERMITTED", { slot_id: "S1", valid_date: "2026-10-06" }));
  assert.equal(evaluateStop(state, stop, "2026-10-06T08:00:00+08:00").ok, true);
  // 许可后设备停运 → 以中断原因为准
  applyEvent(state, mk("DEMO_INTERRUPTED", { slot_id: "S1", reason_code: "device_suspended" }));
  assert.deepEqual(evaluateStop(state, stop, "2026-10-06T08:30:00+08:00").reasons, ["device_suspended"]);
});

test("逐人签署门槛：缺一人即不可进入受限区域，并列出缺签成员", () => {
  const group = baseGroup();
  const events = [mk("GROUP_PROFILED", group)];
  for (const m of ["M1", "M2", "M3"]) events.push(mk("SAFETY_BRIEFED", { member_id: m, zone_id: "Z1" }));
  for (const m of ["M1", "M2"]) events.push(mk("ACCESS_CLEARED", { member_id: m, zone_id: "Z1", signer_id: m }));
  const state = stateWith(...events);
  const stop = group.stops[1];
  const verdict = evaluateStop(state, stop, "2026-10-06T10:00:00+08:00");
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons, ["clearance_incomplete"]);
  assert.deepEqual(verdict.missing_clearances, ["M3"]);
  applyEvent(state, mk("ACCESS_CLEARED", { member_id: "M3", zone_id: "Z1", signer_id: "M3" }));
  assert.equal(evaluateStop(state, stop, "2026-10-06T10:00:00+08:00").ok, true);
});

test("迟到或故障只重排尚未发生的环节，并核对退款条款", () => {
  const group = baseGroup();
  const state = stateWith(
    mk("GROUP_PROFILED", group),
    mk("SLOT_HELD", { slot_id: "S1", refund_policy: { free_cancel_before_min: 120, penalty_pct: 50 } }),
    mk("DEMO_INTERRUPTED", { slot_id: "S1", reason_code: "device_suspended" }, "2026-10-06T07:00:00+08:00"),
  );
  // 07:00 重排：距开场 120 分钟，免费取消并替换为大容量替代项目
  const early = replan(state, "2026-10-06T07:00:00+08:00");
  assert.equal(early.changes.length, 1);
  assert.equal(early.changes[0].action, "replace");
  assert.equal(early.changes[0].with.alt_id, "ALT-BIG");
  assert.equal(early.changes[0].refund.penalty_pct, 0);
  // 08:30 重排：已进入 120 分钟窗口，按条款收取 50%
  const late = replan(state, "2026-10-06T08:30:00+08:00");
  assert.equal(late.changes[0].refund.penalty_pct, 50);
  assert.ok(late.warnings.some((w) => w.code === "refund_penalty"));
  // 10:15 重排：A 环节已结束，不再重排，已发生环节保持原样
  const after = replan(state, "2026-10-06T10:15:00+08:00");
  assert.equal(after.changes.length, 0);
});

test("替代项目容量不足时给出拆团风险警告", () => {
  const group = baseGroup();
  group.alternatives = [group.alternatives[1]]; // 只剩容量 2 的模拟器，团队 3 人
  const state = stateWith(
    mk("GROUP_PROFILED", group),
    mk("SLOT_HELD", { slot_id: "S1", refund_policy: { free_cancel_before_min: 120, penalty_pct: 50 } }),
    mk("DEMO_INTERRUPTED", { slot_id: "S1", reason_code: "device_suspended" }, "2026-10-06T07:00:00+08:00"),
  );
  const plan = replan(state, "2026-10-06T07:00:00+08:00");
  assert.equal(plan.changes[0].with.alt_id, "ALT-SMALL");
  assert.ok(plan.warnings.some((w) => w.code === "group_split_risk"));
});

test("转场时间不足时不硬塞替代项目", () => {
  const group = baseGroup();
  // 替代项目远在 mall：从该处赶往下一站 lab 需要 45 分钟，而空档只有 30 分钟
  group.transfers["lab>mall"] = 45;
  group.alternatives = [{ alt_id: "ALT-FAR", title: "远端展厅", venue_id: "mall", kinds: ["demo"], interests: ["robotics"], languages: ["en"], capacity: 30, duration_min: 60 }];
  const state = stateWith(
    mk("GROUP_PROFILED", group),
    mk("SLOT_HELD", { slot_id: "S1", refund_policy: { free_cancel_before_min: 120, penalty_pct: 50 } }),
    mk("DEMO_INTERRUPTED", { slot_id: "S1", reason_code: "device_suspended" }, "2026-10-06T07:00:00+08:00"),
  );
  const plan = replan(state, "2026-10-06T07:00:00+08:00");
  assert.equal(plan.changes[0].action, "cancel");
  assert.ok(plan.warnings.some((w) => w.code === "transfer_infeasible"));
});

test("购物与领取环节分别依赖跨境付款到账和合作方备货回执", () => {
  const group = baseGroup();
  const state = stateWith(mk("GROUP_PROFILED", group));
  const shopping = { ...group.stops[2] };
  assert.deepEqual(evaluateStop(state, shopping, "2026-10-06T11:00:00+08:00").reasons, ["payment_unsettled"]);
  applyEvent(state, mk("PAYMENT_SETTLED", { order_id: "ORDER-1", amount: 8600, currency: "CNY", rail: "intl_card" }));
  assert.equal(evaluateStop(state, shopping, "2026-10-06T11:00:00+08:00").ok, true);

  const pickup = { stop_id: "D", kind: "pickup", venue_id: "mall", start: "2026-10-06T13:00:00+08:00", end: "2026-10-06T13:30:00+08:00", requires_pickup_ready: "P1" };
  assert.deepEqual(evaluateStop(state, pickup, "2026-10-06T12:00:00+08:00").reasons, ["pickup_not_ready"]);
  applyEvent(state, mk("RECEIPT_RECORDED", { partner: "store", external_ref: "R1", kind: "pickup_ready", ref: "P1" }));
  assert.equal(evaluateStop(state, pickup, "2026-10-06T12:00:00+08:00").ok, true);
});

test("导游端下一站：故障环节被跳过并附原因码，给出真正可执行的环节", () => {
  const group = baseGroup();
  const state = stateWith(
    mk("GROUP_PROFILED", group),
    mk("SLOT_HELD", { slot_id: "S1", refund_policy: { free_cancel_before_min: 120, penalty_pct: 50 } }),
    mk("DEMO_INTERRUPTED", { slot_id: "S1", reason_code: "weather_grounded" }, "2026-10-06T07:00:00+08:00"),
  );
  for (const m of ["M1", "M2", "M3"]) {
    applyEvent(state, mk("SAFETY_BRIEFED", { member_id: m, zone_id: "Z1" }));
    applyEvent(state, mk("ACCESS_CLEARED", { member_id: m, zone_id: "Z1", signer_id: m }));
  }
  const next = nextExecutableStop(state, "2026-10-06T08:00:00+08:00");
  assert.equal(next.stop.stop_id, "B");
  assert.deepEqual(next.skipped[0].reasons, ["weather_grounded"]);
});

test("完整场景回放：重复回执被忽略，研发区尚缺 M06 本人签署", async () => {
  const scenario = JSON.parse(await readFile(new URL("../data/scenario.json", import.meta.url), "utf8"));
  const state = createState();
  const results = applyAll(state, scenario.events);
  assert.ok(results.every((r) => !r.rejected));
  assert.equal(results.filter((r) => r.duplicate).length, 1);

  const now = scenario.now;
  const group = state.group;
  // 自动驾驶：当日许可已下达 → 可执行
  assert.equal(evaluateStop(state, group.stops[0], now).ok, true);
  // 低空飞行：风雨停飞 → 不可执行
  assert.deepEqual(evaluateStop(state, group.stops[1], now).reasons, ["weather_grounded"]);
  // 工厂研发区：M06 未本人签署 → 不可进入
  const factory = evaluateStop(state, group.stops[3], now);
  assert.deepEqual(factory.missing_clearances, ["M06"]);
  // 重排只影响低空飞行这一硬故障环节，并启用机器人工作坊
  const plan = replan(state, now);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].stop_id, "ST2");
  assert.equal(plan.changes[0].with.alt_id, "ALT-1");
  // 研发区缺签属于可补齐的软门槛：列入 pending，不取消环节
  assert.equal(plan.pending.length, 1);
  assert.equal(plan.pending[0].stop_id, "ST4");
  assert.deepEqual(plan.pending[0].missing_clearances, ["M06"]);
  // 导游端此刻的下一站仍是已获许可的自动驾驶演示
  const next = nextExecutableStop(state, now);
  assert.equal(next.stop.stop_id, "ST1");
});
