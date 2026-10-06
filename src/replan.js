import { renderReason } from "./reasons.js";

/**
 * 行程重排器（纯函数，无副作用）。
 *
 * 输入一份按开始时间排序的环节列表和一项中断/迟到事实，输出：
 * - segments：重排后的环节列表（已发生与进行中的环节原样保留，绝不改写历史）；
 * - changes：每个被改动环节的类型、原因码与多语种原因（导游端直接渲染）；
 * - refunds：被取消环节按供应商退款条款算出的退款比例。
 *
 * 重排三核对（详见 docs/orchestration-design.md 第 5 节）：
 * 1. 转场时间：以上一个保留环节为锚点，到达晚于开始则先尝试顺延，顺延越过硬性结束时间才取消；
 * 2. 退款条款：按取消通知提前量在供应商政策上取免费/迟到/爽约三档比例；
 * 3. 团队拆散：替代项目容量不足且团队不允许拆分时，宁可取消也不拆团。
 */

const toMin = (iso) => Date.parse(iso) / 60000;
const toIso = (min) => new Date(Math.round(min) * 60000).toISOString();

function transferBetween(transferMinutes, fromVenue, toVenue) {
  if (!fromVenue || !toVenue || fromVenue === toVenue) return 0;
  const direct = transferMinutes[`${fromVenue}->${toVenue}`];
  if (direct != null) return direct;
  return transferMinutes.default ?? 0;
}

function refundFor(refundPolicies, segment, nowMin) {
  const policy = refundPolicies[segment.supplier] ?? refundPolicies.default;
  if (!policy) return null;
  const notice = toMin(segment.start) - nowMin;
  let ratio;
  if (notice >= (policy.freeCancelBeforeMinutes ?? 0)) ratio = 1;
  else if (notice >= 0) ratio = policy.lateRatio ?? 0;
  else ratio = policy.noShowRatio ?? 0;
  return {
    segmentId: segment.id,
    supplier: segment.supplier ?? null,
    noticeMinutes: Math.round(notice),
    refundRatio: ratio,
  };
}

export function replanItinerary({
  now,
  segments,
  fallbacks = [],
  transferMinutes = {},
  refundPolicies = {},
  allowGroupSplit = false,
  groupSize = 1,
  languages = ["zh"],
}) {
  const nowMin = toMin(now);
  // 已结束或正在进行中的环节锁定，重排只触碰尚未发生的部分。
  const locked = (s) => s.status === "done" || s.status === "active" || toMin(s.end) <= nowMin;

  const changes = [];
  const refunds = [];
  const kept = [];

  const note = (type, segment, reasonCode, extra = {}) => {
    changes.push({
      type,
      segmentId: segment.id,
      reasonCode,
      reasonI18n: renderReason(reasonCode, languages),
      ...extra,
    });
  };

  const pickFallback = (segment, prevVenue, prevEndMin) => {
    let splitBlocked = false;
    for (const fb of fallbacks) {
      const tagsMatch = (segment.tags ?? []).some((t) => (fb.tags ?? []).includes(t));
      if (!tagsMatch) continue;
      if (toMin(fb.availableFrom) > toMin(segment.start) || toMin(fb.availableUntil) < toMin(segment.end)) continue;
      if ((fb.capacity ?? 0) < groupSize && !allowGroupSplit) {
        splitBlocked = true;
        continue;
      }
      const arrival = prevEndMin + transferBetween(transferMinutes, prevVenue, fb.venue);
      if (arrival > toMin(segment.start)) continue;
      return { fb, splitBlocked };
    }
    return { fb: null, splitBlocked };
  };

  for (const raw of segments) {
    const segment = { ...raw };
    if (locked(segment)) {
      kept.push(segment);
      continue;
    }

    const prev = kept[kept.length - 1];
    const prevVenue = prev?.venue ?? null;
    const prevEndMin = prev ? toMin(prev.end) : nowMin;

    if (segment.status === "interrupted") {
      const cause = segment.interruptReason ?? "DEVICE_OFFLINE";
      const { fb, splitBlocked } = pickFallback(segment, prevVenue, prevEndMin);
      if (fb) {
        const replacement = {
          ...segment,
          id: `${segment.id}~${fb.id}`,
          venue: fb.venue,
          title: fb.title,
          fallbackOf: segment.id,
          status: "planned",
        };
        delete replacement.interruptReason;
        kept.push(replacement);
        note("substituted", segment, cause, { replacementId: replacement.id, fallbackId: fb.id });
      } else {
        // 容量不足且不可拆团时，对客口径是“未安排替换”，而不是笼统的设备故障。
        const reasonCode = splitBlocked ? "GROUP_SPLIT_BLOCKED" : cause;
        note("dropped", segment, reasonCode);
        const refund = refundFor(refundPolicies, segment, nowMin);
        if (refund) refunds.push({ ...refund, reasonCode: cause });
      }
      continue;
    }

    const arrival = prevEndMin + transferBetween(transferMinutes, prevVenue, segment.venue);
    if (arrival > toMin(segment.start)) {
      const shift = arrival - toMin(segment.start);
      const hardEnd = segment.hardEnd ? toMin(segment.hardEnd) : null;
      const shiftedEnd = toMin(segment.end) + shift;
      if (segment.shiftable !== false && (hardEnd === null || shiftedEnd <= hardEnd)) {
        segment.start = toIso(toMin(segment.start) + shift);
        segment.end = toIso(shiftedEnd);
        kept.push(segment);
        note("rescheduled", segment, "SCHEDULE_SHIFTED", { newStart: segment.start, newEnd: segment.end });
      } else {
        note("dropped", segment, "TRANSFER_INFEASIBLE");
        const refund = refundFor(refundPolicies, segment, nowMin);
        if (refund) refunds.push({ ...refund, reasonCode: "TRANSFER_INFEASIBLE" });
      }
      continue;
    }

    kept.push(segment);
  }

  return { segments: kept, changes, refunds };
}
