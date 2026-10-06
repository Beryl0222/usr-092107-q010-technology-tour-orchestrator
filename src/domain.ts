/** 科技研学演示编排器使用的领域事件信封。 */
export interface DomainEvent {
  event_id: string;
  event_type: EventType;
  aggregate_type: AggregateType;
  aggregate_id: string;
  occurred_at: string;
  version: number;
  summary: string;
  payload?: Record<string, unknown>;
}

export type EventType =
  | "GROUP_PROFILED" // 登记团队资料与基准行程
  | "SLOT_HELD" // 演示时段占位（预约不等于当日可执行）
  | "SLOT_PERMITTED" // 当日许可下达（自动驾驶 / 低空项目必需）
  | "DEMO_INTERRUPTED" // 设备停运、天气停飞、区域临时关闭
  | "SAFETY_BRIEFED" // 成员逐一完成安全告知
  | "ACCESS_CLEARED" // 成员逐一签署受限区域准入（签署人必须本人）
  | "FILMING_DECIDED" // 工厂拍摄权限审批结果
  | "PAYMENT_SETTLED" // 跨境付款到账
  | "PICKUP_COMPLETED" // 商品领取完成
  | "RECEIPT_RECORDED" // 合作方回执（按 partner+external_ref 幂等）
  | "FALLBACK_ACTIVATED" // 替代项目启用
  | "ITINERARY_REVISED"; // 行程修订（仅未发生环节）

export type AggregateType =
  | "visitor_group"
  | "demo_slot"
  | "access_clearance"
  | "payment_order"
  | "pickup_task"
  | "partner_receipt"
  | "itinerary_revision";

/** 行程中的一个环节。 */
export interface Stop {
  stop_id: string;
  kind: "demo" | "visit" | "meal" | "shopping" | "pickup" | "transfer";
  venue_id: string;
  start: string;
  end: string;
  slot_id?: string; // 关联 demo_slot
  zone_id?: string; // 受限区域，需逐人签署
  requires_permit?: boolean; // 自动驾驶 / 低空项目以当日许可为准
  requires_filming?: boolean; // 依赖工厂拍摄权限
  requires_payment?: string; // 依赖的 payment_order 标识
  requires_pickup_ready?: string; // 依赖合作方回执确认备货
  sensitive?: boolean; // 企业敏感环节，运营复盘不可见细节
}

/** 团队资料与基准行程（GROUP_PROFILED 的 payload）。 */
export interface GroupProfile {
  size: number;
  languages: string[];
  interests: string[];
  member_ids: string[];
  leader_id: string;
  payment_order_id?: string;
  origin_venue_id: string;
  transfers: Record<string, number>; // "venueA>venueB" → 分钟
  stops: Stop[];
  alternatives: Alternative[];
}

/** 替代项目。 */
export interface Alternative {
  alt_id: string;
  title: string;
  venue_id: string;
  kinds: string[];
  interests: string[];
  languages: string[];
  capacity: number;
  duration_min: number;
}

/** 退款条款：开场前 free_cancel_before_min 分钟内取消收取 penalty_pct%。 */
export interface RefundPolicy {
  free_cancel_before_min: number;
  penalty_pct: number;
}
