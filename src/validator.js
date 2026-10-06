const required = ["event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "version", "summary"];

/** 事件类型与所属聚合的对应关系，与 contracts/domain.schema.json 的枚举保持一致。 */
export const EVENT_AGGREGATE = {
  GROUP_PROFILED: "visitor_group",
  SLOT_HELD: "demo_slot",
  SLOT_RELEASED: "demo_slot",
  DAY_PERMIT_ISSUED: "day_permit",
  DAY_PERMIT_REVOKED: "day_permit",
  DEVICE_STATUS_CHANGED: "device_asset",
  OPERATOR_QUALIFICATION_VERIFIED: "operator",
  VISITOR_DOCUMENT_VERIFIED: "access_clearance",
  SAFETY_BRIEFING_ACKED: "access_clearance",
  RESTRICTED_AREA_SIGNED: "access_clearance",
  ACCESS_CLEARED: "access_clearance",
  FILMING_PERMIT_GRANTED: "filming_permit",
  FILMING_PERMIT_REVOKED: "filming_permit",
  PAYMENT_SETTLED: "payment_order",
  REFUND_ISSUED: "payment_order",
  PICKUP_READY: "pickup_order",
  PICKUP_COMPLETED: "pickup_order",
  DEMO_INTERRUPTED: "demo_slot",
  FALLBACK_ACTIVATED: "fallback_program",
  ITINERARY_REVISED: "itinerary_revision",
  PARTNER_RECEIPT_RECORDED: "partner_receipt",
};

const AGGREGATES = new Set(Object.values(EVENT_AGGREGATE));

export function validateEvent(record) {
  const errors = required.filter((name) => !(name in record)).map((name) => `缺少字段：${name}`);
  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) errors.push("version 必须是正整数");
  if ("occurred_at" in record && Number.isNaN(Date.parse(record.occurred_at))) errors.push("occurred_at 必须是可解析的时间");
  if ("event_type" in record && !(record.event_type in EVENT_AGGREGATE)) errors.push(`未知事件类型：${record.event_type}`);
  if ("aggregate_type" in record && !AGGREGATES.has(record.aggregate_type)) errors.push(`未知聚合类型：${record.aggregate_type}`);
  if (record.event_type in EVENT_AGGREGATE && "aggregate_type" in record && EVENT_AGGREGATE[record.event_type] !== record.aggregate_type) {
    errors.push(`事件 ${record.event_type} 应挂在聚合 ${EVENT_AGGREGATE[record.event_type]} 上`);
  }

  const payload = record.payload ?? {};
  if (record.event_type === "ITINERARY_REVISED") {
    const i18n = payload.reason_i18n;
    if (!i18n || typeof i18n !== "object" || Object.keys(i18n).length === 0) {
      errors.push("ITINERARY_REVISED 需要 payload.reason_i18n 提供多语种变更原因");
    }
  }
  if (record.event_type === "RESTRICTED_AREA_SIGNED") {
    // 受限区域按人员逐一签署，领队不得代签。
    if (!payload.member_id || payload.signer_id !== payload.member_id) {
      errors.push("受限区域须本人逐一签署，signer_id 必须等于 member_id");
    }
  }
  if (record.event_type === "PARTNER_RECEIPT_RECORDED") {
    // 回执必须指向原事件，消费方按 event_id 幂等去重。
    if (typeof payload.receipt_of !== "string" || payload.receipt_of.length === 0) {
      errors.push("合作方回执需要 payload.receipt_of 指向原事件");
    }
  }
  return errors;
}
