const required = ["event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "version", "summary"];

const EVENT_TYPES = [
  "GROUP_PROFILED",
  "SLOT_HELD",
  "SLOT_PERMITTED",
  "DEMO_INTERRUPTED",
  "SAFETY_BRIEFED",
  "ACCESS_CLEARED",
  "FILMING_DECIDED",
  "PAYMENT_SETTLED",
  "PICKUP_COMPLETED",
  "RECEIPT_RECORDED",
  "FALLBACK_ACTIVATED",
  "ITINERARY_REVISED",
];

const AGGREGATE_TYPES = [
  "visitor_group",
  "demo_slot",
  "access_clearance",
  "payment_order",
  "pickup_task",
  "partner_receipt",
  "itinerary_revision",
];

/** 事件类型与聚合类型的固定搭配。 */
const EVENT_AGGREGATE = {
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

export function validateEvent(record) {
  const errors = required.filter((name) => !(name in record)).map((name) => `缺少字段：${name}`);
  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) errors.push("version 必须是正整数");
  if ("event_type" in record && !EVENT_TYPES.includes(record.event_type)) errors.push(`未知事件类型：${record.event_type}`);
  if ("aggregate_type" in record && !AGGREGATE_TYPES.includes(record.aggregate_type)) errors.push(`未知聚合类型：${record.aggregate_type}`);
  if (errors.length === 0 && EVENT_AGGREGATE[record.event_type] !== record.aggregate_type) {
    errors.push(`${record.event_type} 必须挂在 ${EVENT_AGGREGATE[record.event_type]} 聚合上`);
  }

  const p = record.payload ?? {};
  switch (record.event_type) {
    case "ACCESS_CLEARED":
      // 受限区域按人员逐一签署，领队不得代签。
      if (!p.member_id || !p.zone_id) errors.push("ACCESS_CLEARED 需要 member_id 与 zone_id");
      if (p.signer_id !== p.member_id) errors.push("签署人必须是成员本人，不能由领队或他人代签");
      break;
    case "SAFETY_BRIEFED":
      if (!p.member_id || !p.zone_id) errors.push("SAFETY_BRIEFED 需要 member_id 与 zone_id");
      break;
    case "SLOT_PERMITTED":
      if (!p.valid_date) errors.push("SLOT_PERMITTED 需要 valid_date（许可仅当日有效）");
      break;
    case "RECEIPT_RECORDED":
      if (!p.partner || !p.external_ref) errors.push("RECEIPT_RECORDED 需要 partner 与 external_ref 用于幂等去重");
      break;
    case "FILMING_DECIDED":
      if (!p.zone_id || typeof p.approved !== "boolean") errors.push("FILMING_DECIDED 需要 zone_id 与 approved");
      break;
    default:
      break;
  }
  return errors;
}
