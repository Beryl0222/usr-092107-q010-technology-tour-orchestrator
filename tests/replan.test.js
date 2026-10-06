import assert from "node:assert/strict";
import test from "node:test";

import { replanItinerary } from "../src/replan.js";

const T = (s) => `2026-10-06T${s}:00+08:00`;

const robotLab = {
  id: "fb-robot-lab",
  title: "室内机器人工坊",
  venue: "maker-space",
  tags: ["robotics", "low-altitude"],
  capacity: 30,
  availableFrom: T("08:00"),
  availableUntil: T("18:00"),
};

test("已发生与进行中的环节不被改写", () => {
  const done = { id: "seg-bus", venue: "hotel", start: T("08:00"), end: T("09:00"), status: "done" };
  const active = { id: "seg-av-ride", venue: "av-park", start: T("09:30"), end: T("10:30"), status: "active" };
  const future = { id: "seg-store", venue: "robot-store", start: T("11:00"), end: T("12:00"), status: "planned" };
  const { segments, changes } = replanItinerary({ now: T("10:00"), segments: [done, active, future] });
  assert.deepEqual(segments[0], done);
  assert.deepEqual(segments[1], active);
  assert.deepEqual(changes, []);
});

test("无人机因风雨停飞时替换为同主题替代项目并给出多语种原因", () => {
  const uavDemo = {
    id: "seg-uav",
    venue: "flight-field",
    start: T("10:00"),
    end: T("11:00"),
    status: "interrupted",
    interruptReason: "WEATHER_GROUNDED",
    tags: ["low-altitude"],
    supplier: "uav-operator",
  };
  const { segments, changes } = replanItinerary({
    now: T("09:30"),
    segments: [uavDemo],
    fallbacks: [robotLab],
    groupSize: 20,
    languages: ["zh", "en", "ja"],
  });
  assert.equal(segments[0].fallbackOf, "seg-uav");
  assert.equal(segments[0].venue, "maker-space");
  assert.equal(changes[0].type, "substituted");
  assert.equal(changes[0].reasonCode, "WEATHER_GROUNDED");
  assert.match(changes[0].reasonI18n.zh, /风雨/);
  assert.match(changes[0].reasonI18n.en, /grounded/);
  assert.match(changes[0].reasonI18n.ja, /運休/);
});

test("转场时间不足且不可顺延的环节被取消并按退款条款计比例", () => {
  const prev = { id: "seg-factory", venue: "factory", start: T("12:00"), end: T("14:00"), status: "active" };
  const next = {
    id: "seg-show",
    venue: "bay-theater",
    start: T("14:10"),
    end: T("15:00"),
    status: "planned",
    shiftable: false,
    supplier: "theater",
  };
  const { segments, changes, refunds } = replanItinerary({
    now: T("13:00"),
    segments: [prev, next],
    transferMinutes: { "factory->bay-theater": 30 },
    refundPolicies: { theater: { freeCancelBeforeMinutes: 120, lateRatio: 0.5, noShowRatio: 0 } },
  });
  assert.deepEqual(segments.map((s) => s.id), ["seg-factory"]);
  assert.equal(changes[0].reasonCode, "TRANSFER_INFEASIBLE");
  // 13:00 取消 14:10 的场次，通知提前 70 分钟，落在迟到档，退 50%。
  assert.deepEqual(refunds, [
    { segmentId: "seg-show", supplier: "theater", noticeMinutes: 70, refundRatio: 0.5, reasonCode: "TRANSFER_INFEASIBLE" },
  ]);
});

test("替代项目容量不足且团队不可拆散时不拆团", () => {
  const demo = {
    id: "seg-uav",
    venue: "flight-field",
    start: T("10:00"),
    end: T("11:00"),
    status: "interrupted",
    interruptReason: "WEATHER_GROUNDED",
    tags: ["low-altitude"],
  };
  const { segments, changes } = replanItinerary({
    now: T("09:30"),
    segments: [demo],
    fallbacks: [{ ...robotLab, capacity: 10 }],
    groupSize: 20,
    allowGroupSplit: false,
  });
  assert.equal(segments.length, 0);
  assert.equal(changes[0].type, "dropped");
  assert.equal(changes[0].reasonCode, "GROUP_SPLIT_BLOCKED");
});

test("迟到导致后续环节在硬性结束时间内涵盖式顺延", () => {
  const running = { id: "seg-av-ride", venue: "av-park", start: T("09:30"), end: T("10:30"), status: "active" };
  const store = {
    id: "seg-store",
    venue: "robot-store",
    start: T("10:30"),
    end: T("11:30"),
    status: "planned",
    hardEnd: T("12:00"),
  };
  const { segments, changes } = replanItinerary({
    now: T("10:00"),
    segments: [running, store],
    transferMinutes: { "av-park->robot-store": 20 },
  });
  // 10:30 结束 + 20 分钟转场 = 10:50 才能到，整体顺延 20 分钟，未越过 12:00 硬性结束时间。
  assert.equal(Date.parse(segments[1].start), Date.parse(T("10:50")));
  assert.equal(Date.parse(segments[1].end), Date.parse(T("11:50")));
  assert.equal(changes[0].type, "rescheduled");
  assert.equal(changes[0].reasonCode, "SCHEDULE_SHIFTED");
});
