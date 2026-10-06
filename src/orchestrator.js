import { validateEvent } from "./validator.js";

/** 未在转场表中登记的两点间默认转场分钟数。 */
const DEFAULT_TRANSFER_MIN = 20;

/** 自动驾驶与低空飞行类项目：预约只是占位，当日许可下达后才可执行。 */
export function createState() {
  return {
    group: null, // GROUP_PROFILED 的 payload
    slots: new Map(), // slot_id → { held, permits: [], interrupted }
    briefings: new Set(), // "member|zone" 已完成安全告知
    clearances: new Set(), // "member|zone" 本人已签署
    filming: new Map(), // zone_id → boolean
    payments: new Map(), // order_id → payload
    pickups: new Map(), // task_id → true
    receipts: new Map(), // "partner|external_ref" → { event, duplicates }
    revisions: [], // ITINERARY_REVISED payload
    fallbacks: [], // FALLBACK_ACTIVATED payload
    violations: [], // 被拒绝的非法事件（如领队代签）
  };
}

/**
 * 归约一条领域事件。返回 { duplicate?, rejected? } 供调用方判断。
 * 合作方回执按 partner+external_ref 幂等：重复回执只计数，不改状态。
 */
export function applyEvent(state, event) {
  const errors = validateEvent(event);
  if (errors.length > 0) {
    state.violations.push({ event_id: event.event_id, errors });
    return { rejected: errors };
  }
  const p = event.payload ?? {};
  switch (event.event_type) {
    case "GROUP_PROFILED":
      state.group = p;
      break;
    case "SLOT_HELD": {
      const slot = state.slots.get(p.slot_id) ?? { permits: [] };
      slot.held = p;
      state.slots.set(p.slot_id, slot);
      break;
    }
    case "SLOT_PERMITTED": {
      const slot = state.slots.get(p.slot_id) ?? { permits: [] };
      slot.permits.push({ valid_date: p.valid_date, scope: p.scope });
      state.slots.set(p.slot_id, slot);
      break;
    }
    case "DEMO_INTERRUPTED": {
      const slot = state.slots.get(p.slot_id) ?? { permits: [] };
      slot.interrupted = { reason_code: p.reason_code, at: event.occurred_at };
      state.slots.set(p.slot_id, slot);
      break;
    }
    case "SAFETY_BRIEFED":
      state.briefings.add(`${p.member_id}|${p.zone_id}`);
      break;
    case "ACCESS_CLEARED":
      // 校验器已保证 signer_id === member_id；这里只记录本人签署结果。
      state.clearances.add(`${p.member_id}|${p.zone_id}`);
      break;
    case "FILMING_DECIDED":
      state.filming.set(p.zone_id, p.approved);
      break;
    case "PAYMENT_SETTLED":
      state.payments.set(p.order_id, p);
      break;
    case "PICKUP_COMPLETED":
      state.pickups.set(p.task_id, true);
      break;
    case "RECEIPT_RECORDED": {
      const key = `${p.partner}|${p.external_ref}`;
      const existing = state.receipts.get(key);
      if (existing) {
        existing.duplicates += 1;
        return { duplicate: true };
      }
      state.receipts.set(key, { event, duplicates: 0 });
      break;
    }
    case "FALLBACK_ACTIVATED":
      state.fallbacks.push(p);
      break;
    case "ITINERARY_REVISED":
      state.revisions.push(p);
      break;
    default:
      break;
  }
  return {};
}

export function applyAll(state, events) {
  const results = [];
  for (const event of events) results.push(applyEvent(state, event));
  return results;
}

/** 两点间转场分钟数；未登记时取反向登记值，再兜底默认値。 */
export function transferMin(group, fromVenue, toVenue) {
  if (fromVenue === toVenue) return 0;
  const table = group?.transfers ?? {};
  return table[`${fromVenue}>${toVenue}`] ?? table[`${toVenue}>${fromVenue}`] ?? DEFAULT_TRANSFER_MIN;
}

const dateOf = (iso) => iso.slice(0, 10);
const minutesBetween = (a, b) => (new Date(a).getTime() - new Date(b).getTime()) / 60000;

/** 合作方是否已回执确认某类事项（如 pickup_ready）。 */
export function hasReceipt(state, kind, ref) {
  for (const { event } of state.receipts.values()) {
    const p = event.payload ?? {};
    if (p.kind === kind && (ref === undefined || p.ref === ref)) return true;
  }
  return false;
}

/**
 * 评估一个环节此刻是否可执行。
 * 返回 { ok, reasons: [原因码], missing_clearances: [member_id] }。
 */
export function evaluateStop(state, stop, now) {
  const reasons = [];
  const missing = [];
  const slot = stop.slot_id ? state.slots.get(stop.slot_id) : undefined;

  if (slot?.interrupted) reasons.push(slot.interrupted.reason_code);

  // 已中断的时段以中断原因为准，不再叠加许可状态。
  if (stop.requires_permit && !slot?.interrupted) {
    const ok = slot?.permits?.some((permit) => permit.valid_date === dateOf(stop.start));
    if (!ok) reasons.push("permit_pending");
  }

  if (stop.zone_id && state.group) {
    for (const memberId of state.group.member_ids) {
      const briefed = state.briefings.has(`${memberId}|${stop.zone_id}`);
      const signed = state.clearances.has(`${memberId}|${stop.zone_id}`);
      if (!briefed || !signed) missing.push(memberId);
    }
    if (missing.length > 0) reasons.push("clearance_incomplete");
  }

  if (stop.requires_filming && state.filming.get(stop.zone_id) !== true) reasons.push("filming_denied");

  if (stop.requires_payment && !state.payments.get(stop.requires_payment)) reasons.push("payment_unsettled");

  if (stop.requires_pickup_ready && !hasReceipt(state, "pickup_ready", stop.requires_pickup_ready)) {
    reasons.push("pickup_not_ready");
  }

  return { ok: reasons.length === 0, reasons, missing_clearances: missing };
}

/** 计算取消某时段的退款结果。 */
export function refundFor(slot, stop, now) {
  const policy = slot?.held?.refund_policy;
  if (!policy) return { policy: null, penalty_pct: 0 };
  const minutesToStart = minutesBetween(stop.start, now);
  const penalty = minutesToStart < policy.free_cancel_before_min ? policy.penalty_pct : 0;
  return { policy, penalty_pct: penalty };
}

/** 为失效环节挑选替代项目：兴趣匹配、语言覆盖、容量与转场都可行。 */
function pickAlternative(state, stop, prevVenue, prevEnd, nextStop) {
  const group = state.group;
  const scored = [];
  for (const alt of group.alternatives ?? []) {
    if (!alt.kinds?.includes(stop.kind)) continue;
    const langOk = group.languages.some((lang) => alt.languages.includes(lang));
    if (!langOk) continue;
    const interestScore = alt.interests.filter((i) => group.interests.includes(i)).length;
    const fitsWindow = alt.duration_min <= minutesBetween(stop.end, stop.start);
    const inMin = transferMin(group, prevVenue, alt.venue_id);
    const outMin = nextStop ? transferMin(group, alt.venue_id, nextStop.venue_id) : 0;
    const transferOk =
      minutesBetween(stop.start, prevEnd) >= inMin && (!nextStop || minutesBetween(nextStop.start, stop.end) >= outMin);
    scored.push({ alt, interestScore, fitsWindow, transferOk, capacityOk: alt.capacity >= group.size });
  }
  scored.sort((a, b) => b.interestScore - a.interestScore);
  if (scored.length === 0) return { alt: null, warnings: ["no_alternative"] };
  const feasible = scored.find((c) => c.fitsWindow && c.transferOk && c.capacityOk);
  if (feasible) return { alt: feasible.alt, warnings: [] };
  // 没有完美候选时退而求其次，并明确给出风险警告。
  const fallback = scored.find((c) => c.fitsWindow && c.transferOk);
  if (!fallback) return { alt: null, warnings: ["transfer_infeasible"] };
  const warnings = [];
  if (!fallback.capacityOk) warnings.push("group_split_risk");
  return { alt: fallback.alt, warnings };
}

/** 触发重排的硬故障：设备停运、天气停飞、区域关闭、拍摄被拒。 */
const HARD_REASONS = new Set(["device_suspended", "weather_grounded", "zone_closed", "filming_denied"]);

/**
 * 迟到或故障时重排：只对硬故障且尚未发生的环节（end > now）做替换或取消，
 * 已发生环节保持原样；签署、付款、备货等可待补齐的软门槛列入 pending 不动行程。
 * 同时核对转场时间、退款条款与拆团风险。
 */
export function replan(state, now) {
  const group = state.group;
  if (!group) return { changes: [], warnings: [], pending: [], reason_codes: [] };
  const stops = [...group.stops].sort((a, b) => a.start.localeCompare(b.start));
  const changes = [];
  const warnings = [];
  const pending = [];
  const reasonCodes = new Set();

  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i];
    if (stop.end <= now) continue; // 已发生，不重排
    const verdict = evaluateStop(state, stop, now);
    if (verdict.ok) continue;
    verdict.reasons.forEach((code) => reasonCodes.add(code));

    if (!verdict.reasons.some((code) => HARD_REASONS.has(code))) {
      // 软门槛：现场仍可补齐（补签、付款到账、合作方回执），只提示不改行程。
      pending.push({ stop_id: stop.stop_id, reasons: verdict.reasons, missing_clearances: verdict.missing_clearances });
      continue;
    }

    const prevVenue = i === 0 ? group.origin_venue_id : stops[i - 1].venue_id;
    const prevEnd = i === 0 ? now : stops[i - 1].end;
    const nextStop = stops[i + 1] ?? null;
    const { alt, warnings: altWarnings } = pickAlternative(state, stop, prevVenue, prevEnd, nextStop);
    warnings.push(...altWarnings.map((code) => ({ code, stop_id: stop.stop_id })));
    altWarnings.forEach((code) => reasonCodes.add(code));

    const slot = stop.slot_id ? state.slots.get(stop.slot_id) : undefined;
    const refund = refundFor(slot, stop, now);
    if (refund.penalty_pct > 0) {
      warnings.push({ code: "refund_penalty", stop_id: stop.stop_id, penalty_pct: refund.penalty_pct });
      reasonCodes.add("refund_penalty");
    }

    if (alt) {
      changes.push({
        stop_id: stop.stop_id,
        action: "replace",
        with: { alt_id: alt.alt_id, title: alt.title, venue_id: alt.venue_id, capacity: alt.capacity },
        refund,
      });
      reasonCodes.add("replaced_by_fallback");
    } else {
      changes.push({ stop_id: stop.stop_id, action: "cancel", refund });
    }
  }
  return { changes, warnings, pending, reason_codes: [...reasonCodes] };
}

/**
 * 导游端：此刻真正可执行的下一站。
 * 从当前位置出发，按顺序找到第一个门槛通过且转场可达的环节；
 * 被跳过的环节附原因码，供多语种展示。
 */
export function nextExecutableStop(state, now) {
  const group = state.group;
  if (!group) return { stop: null, skipped: [], reason_codes: [] };
  const stops = [...group.stops].sort((a, b) => a.start.localeCompare(b.start));
  const done = stops.filter((s) => s.end <= now);
  let currentVenue = done.length > 0 ? done[done.length - 1].venue_id : group.origin_venue_id;
  const skipped = [];

  for (const stop of stops) {
    if (stop.end <= now) continue;
    const transfer = transferMin(group, currentVenue, stop.venue_id);
    const earliestArrival = new Date(new Date(now).getTime() + transfer * 60000).toISOString();
    const verdict = evaluateStop(state, stop, now);
    const reachable = earliestArrival <= stop.end;
    if (verdict.ok && reachable) {
      return {
        stop,
        depart_by: now,
        earliest_arrival: earliestArrival,
        transfer_min: transfer,
        skipped,
        reason_codes: ["on_track"],
      };
    }
    const reasons = [...verdict.reasons];
    if (!reachable) reasons.push("transfer_infeasible");
    skipped.push({ stop_id: stop.stop_id, reasons, missing_clearances: verdict.missing_clearances });
    // 环节失效后，后续评估仍从当前位置出发（等待重排结果）。
  }
  return { stop: null, skipped, reason_codes: [...new Set(skipped.flatMap((s) => s.reasons))] };
}
