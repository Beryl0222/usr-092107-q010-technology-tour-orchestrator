/**
 * 变更原因目录。导游端按团队语言渲染；某语种缺失时回退到中文。
 * 每个原因码同时用于事件 payload.reason_code 与重排结果，保证对客口径一致。
 */
export const REASONS = {
  WEATHER_GROUNDED: {
    zh: "受风雨天气影响，低空飞行项目当日未获放行",
    en: "Low-altitude flights are grounded today due to wind and rain",
    ja: "風雨のため、本日の低空飛行プログラムは運休となりました",
  },
  DEVICE_OFFLINE: {
    zh: "演示设备临时离线，等待运维恢复",
    en: "The demonstration vehicle is temporarily offline pending maintenance",
    ja: "デモ車両が一時的にオフラインになり、復旧を待っています",
  },
  PERMIT_REVOKED: {
    zh: "当日许可被撤回，该环节按占位预约规则取消",
    en: "The same-day permit was revoked; this placeholder booking is cancelled",
    ja: "当日許可が取り消されたため、仮予約はキャンセルされました",
  },
  AREA_CLOSED: {
    zh: "合作企业临时关闭参访区域",
    en: "The host company has temporarily closed this area",
    ja: "受け入れ先企業がこのエリアを一時閉鎖しました",
  },
  FALLBACK_SUBSTITUTED: {
    zh: "已替换为同等主题的替代项目",
    en: "Substituted with an alternative program on the same theme",
    ja: "同テーマの代替プログラムに振り替えました",
  },
  TRANSFER_INFEASIBLE: {
    zh: "转场时间不足，无法按时抵达下一站",
    en: "Transfer time is insufficient to reach the next stop on schedule",
    ja: "移動時間が不足し、次の訪問先に間に合いません",
  },
  GROUP_SPLIT_BLOCKED: {
    zh: "替代项目容量不足且团队不可拆散，未安排替换",
    en: "The alternative cannot host the whole group and splitting is not allowed",
    ja: "代替プログラムの定員が不足し、団体を分割できないため振替はありません",
  },
  SCHEDULE_SHIFTED: {
    zh: "因前序环节调整，本环节顺延",
    en: "Shifted later because an earlier stop changed",
    ja: "前の行程変更により繰り下げとなりました",
  },
  LATE_ARRIVAL: {
    zh: "团队迟到，后续环节顺延",
    en: "The group arrived late; following stops are shifted",
    ja: "到着が遅れたため、以降の行程を繰り下げます",
  },
};

/** 按团队语言列表渲染某个原因码；缺失语种回退中文。 */
export function renderReason(code, languages = ["zh"]) {
  const entry = REASONS[code];
  if (!entry) return {};
  const out = {};
  for (const lang of languages) out[lang] = entry[lang] ?? entry.zh;
  return out;
}
