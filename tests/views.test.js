import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applyAll, createState } from "../src/orchestrator.js";
import { enterpriseView, guideView, operatorAnalytics } from "../src/views.js";

async function scenarioState() {
  const scenario = JSON.parse(await readFile(new URL("../data/scenario.json", import.meta.url), "utf8"));
  const state = createState();
  applyAll(state, scenario.events);
  return { state, now: scenario.now };
}

test("导游端视图：下一站可执行，被跳过环节给出多语种原因", async () => {
  const { state, now } = await scenarioState();
  const view = guideView(state, now);
  assert.equal(view.next_stop.stop_id, "ST1");
  // 低空飞行停飞原因以团队语言（en）与中文同时给出
  const later = guideView(state, "2026-10-06T10:00:00+08:00");
  const skipped = later.skipped.find((s) => s.stop_id === "ST2");
  const weather = skipped.reasons.find((r) => r.code === "weather_grounded");
  assert.match(weather.messages.en, /grounded/);
  assert.match(weather.messages.zh, /停飞/);
  // 研发区还差 M06 本人签署
  assert.deepEqual(view.pending_clearances.ST4, ["M06"]);
});

test("企业只收到接待所需信息：无人身份、付款与其他参观点", async () => {
  const { state } = await scenarioState();
  const view = enterpriseView(state, "factory");
  assert.equal(view.headcount, 6);
  assert.deepEqual(view.languages, ["en", "zh"]);
  assert.deepEqual(view.clearance_progress, { signed: 5, total: 6 });
  assert.equal(view.filming_permitted, true);
  const raw = JSON.stringify(view);
  for (const leaked of ["M01", "M06", "signer", "id_doc", "amount", "ORDER-1", "av_park", "robot_store", "interests"]) {
    assert.ok(!raw.includes(leaked), `企业视图不应包含 ${leaked}`);
  }
});

test("运营复盘看不到企业敏感资料，只见聚合指标", async () => {
  const { state } = await scenarioState();
  const view = operatorAnalytics(state);
  assert.equal(view.group_size, 6);
  assert.equal(view.purchase_total, 8600);
  // 工厂研发区是敏感环节，不进入参观明细
  assert.equal(view.visits_by_kind.visit, undefined);
  assert.equal(view.visits_by_kind.demo, 2);
  const raw = JSON.stringify(view);
  for (const leaked of ["M01", "ZONE-RD", "factory", "corridor_only", "id_doc"]) {
    assert.ok(!raw.includes(leaked), `运营复盘不应包含 ${leaked}`);
  }
});
