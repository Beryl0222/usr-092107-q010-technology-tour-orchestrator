/** 科技研学演示编排器使用的领域事件信封。 */
export interface DomainEvent {
  event_id: string;
  event_type: EventType;
  aggregate_type: AggregateType;
  aggregate_id: string;
  occurred_at: string;
  version: number;
  summary: string;
  /** 触发本事件的上游事件 id（如 DEMO_INTERRUPTED 触发 ITINERARY_REVISED）。 */
  causation_id?: string;
  /** 更正历史记录时指向被更正事件的 id；原记录不原地改写。 */
  supersedes?: string;
  /** 产生本事件的系统或角色，如 replan-service、clearance-service。 */
  actor?: string;
  payload?: Record<string, unknown>;
}

export type AggregateType =
  | "visitor_group"
  | "demo_slot"
  | "day_permit"
  | "device_asset"
  | "operator"
  | "access_clearance"
  | "filming_permit"
  | "payment_order"
  | "pickup_order"
  | "fallback_program"
  | "itinerary_revision"
  | "partner_receipt";

export type EventType =
  | "GROUP_PROFILED"
  | "SLOT_HELD"
  | "SLOT_RELEASED"
  | "DAY_PERMIT_ISSUED"
  | "DAY_PERMIT_REVOKED"
  | "DEVICE_STATUS_CHANGED"
  | "OPERATOR_QUALIFICATION_VERIFIED"
  | "VISITOR_DOCUMENT_VERIFIED"
  | "SAFETY_BRIEFING_ACKED"
  | "RESTRICTED_AREA_SIGNED"
  | "ACCESS_CLEARED"
  | "FILMING_PERMIT_GRANTED"
  | "FILMING_PERMIT_REVOKED"
  | "PAYMENT_SETTLED"
  | "REFUND_ISSUED"
  | "PICKUP_READY"
  | "PICKUP_COMPLETED"
  | "DEMO_INTERRUPTED"
  | "FALLBACK_ACTIVATED"
  | "ITINERARY_REVISED"
  | "PARTNER_RECEIPT_RECORDED";

/** ITINERARY_REVISED 的 payload：导游端按团队语言渲染 reason_i18n。 */
export interface ItineraryRevisionPayload {
  reason_code: string;
  reason_i18n: Record<string, string>;
  changes: Array<{
    type: "substituted" | "dropped" | "rescheduled";
    segment_id: string;
    replacement_id?: string;
    new_start?: string;
    new_end?: string;
  }>;
}

/** RESTRICTED_AREA_SIGNED 的 payload：受限区域按人员逐一签署，领队不得代签。 */
export interface RestrictedAreaSignaturePayload {
  member_id: string;
  signer_id: string;
  zone_id: string;
}

/** PARTNER_RECEIPT_RECORDED 的 payload：receipt_of 指向原事件，消费方按 event_id 幂等去重。 */
export interface PartnerReceiptPayload {
  receipt_of: string;
  partner_id: string;
  status: "accepted" | "rejected";
}
