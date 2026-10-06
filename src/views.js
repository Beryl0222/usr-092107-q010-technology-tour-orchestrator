import { evaluateStop, nextExecutableStop } from "./orchestrator.js";
import { localizeAll } from "./reasons.js";

/**
 * 导游端视图：此刻真正可执行的下一站、被跳过环节的多语种原因、
 * 以及受限区域还差哪些成员本人签署。
 */
export function guideView(state, now) {
  const group = state.group;
  const next = nextExecutableStop(state, now);
  const languages = group?.languages ?? [];
  const skipped = next.skipped.map((item) => ({
    stop_id: item.stop_id,
    reasons: localizeAll(item.reasons, languages),
    missing_clearances: item.missing_clearances,
  }));
  const pendingClearances = {};
  for (const stop of group?.stops ?? []) {
    if (!stop.zone_id || stop.end <= now) continue;
    const verdict = evaluateStop(state, stop, now);
    if (verdict.missing_clearances.length > 0) pendingClearances[stop.stop_id] = verdict.missing_clearances;
  }
  return {
    now,
    next_stop: next.stop
      ? {
          stop_id: next.stop.stop_id,
          venue_id: next.stop.venue_id,
          start: next.stop.start,
          end: next.stop.end,
          depart_by: next.depart_by,
          earliest_arrival: next.earliest_arrival,
          transfer_min: next.transfer_min,
        }
      : null,
    skipped,
    pending_clearances: pendingClearances,
  };
}

/**
 * 企业接待视图：只给接待所需信息——到达窗口、人数、语言与签署进度计数。
 * 不含成员身份、证件、付款、其他参观点与企业经营范围外的任何字段。
 */
export function enterpriseView(state, venueId) {
  const group = state.group;
  if (!group) return null;
  const stop = group.stops.find((s) => s.venue_id === venueId);
  if (!stop) return null;
  const signedCount = stop.zone_id
    ? group.member_ids.filter((m) => state.clearances.has(`${m}|${stop.zone_id}`)).length
    : group.size;
  return {
    venue_id: venueId,
    arrival_window: { start: stop.start, end: stop.end },
    headcount: group.size,
    languages: group.languages,
    filming_permitted: stop.zone_id ? state.filming.get(stop.zone_id) === true : undefined,
    clearance_progress: stop.zone_id ? { signed: signedCount, total: group.size } : undefined,
  };
}

/**
 * 运营方复盘视图：参观、购买与产业对接转化的聚合指标。
 * 只读白名单字段；企业敏感环节（sensitive）不计入明细，个人与证件信息不出现。
 */
export function operatorAnalytics(state) {
  const group = state.group;
  const visits = {};
  for (const stop of group?.stops ?? []) {
    if (stop.sensitive) continue; // 企业敏感环节不进入复盘明细
    visits[stop.kind] = (visits[stop.kind] ?? 0) + 1;
  }
  let purchaseTotal = 0;
  let purchaseCurrency = null;
  for (const p of state.payments.values()) {
    purchaseTotal += p.amount ?? 0;
    purchaseCurrency = p.currency ?? purchaseCurrency;
  }
  const referrals = state.fallbacks.filter((f) => f.kind === "industry_referral").length;
  return {
    group_size: group?.size ?? 0,
    languages: group?.languages ?? [],
    visits_by_kind: visits,
    purchase_total: purchaseTotal,
    purchase_currency: purchaseCurrency,
    industry_referrals: referrals,
    revisions: state.revisions.length,
  };
}
