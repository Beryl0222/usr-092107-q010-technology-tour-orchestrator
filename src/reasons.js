/** 变更原因码 → 多语种文案。导游端按团队语言逐条展示。 */
export const REASONS = {
  device_suspended: {
    zh: "设备临时停运，运营商正在排查",
    en: "The vehicles are temporarily out of service; the operator is investigating.",
    ja: "車両が一時運休となり、事業者が原因を確認しています。",
  },
  weather_grounded: {
    zh: "受风雨影响，低空飞行项目当日停飞",
    en: "Low-altitude flights are grounded today due to wind and rain.",
    ja: "風雨のため、本日の低空飛行は中止となりました。",
  },
  zone_closed: {
    zh: "企业临时关闭了相关区域",
    en: "The host company has temporarily closed this area.",
    ja: "受入先企業が当該エリアを一時閉鎖しました。",
  },
  permit_pending: {
    zh: "当日许可尚未下达，预约仅为占位",
    en: "Today's operating permit has not been issued yet; the booking is only a placeholder.",
    ja: "本日の運行許可がまだ下りていません。予約は仮押さえです。",
  },
  clearance_incomplete: {
    zh: "受限区域需全体成员逐一完成安全告知并本人签署，领队不能代签",
    en: "Every member must personally complete the safety briefing and sign; the tour leader cannot sign on anyone's behalf.",
    ja: "全員が個別に安全説明を受け本人署名する必要があり、添乗員による代签はできません。",
  },
  filming_denied: {
    zh: "工厂未批准该区域拍摄权限",
    en: "The factory has not approved filming in this area.",
    ja: "工場側がこのエリアでの撮影を許可しませんでした。",
  },
  payment_unsettled: {
    zh: "跨境付款尚未到账，购物环节暂缓",
    en: "The cross-border payment has not settled yet, so the shopping stop is on hold.",
    ja: "越境決済がまだ完了していないため、買い物時間は保留中です。",
  },
  pickup_not_ready: {
    zh: "合作方尚未确认备货，商品领取暂缓",
    en: "The partner has not confirmed the goods are ready, so pickup is on hold.",
    ja: "提携先が商品の準備完了をまだ確認していないため、受け取りは保留中です。",
  },
  transfer_infeasible: {
    zh: "转场时间不足，无法按时抵达下一站",
    en: "There is not enough transfer time to reach the next stop on schedule.",
    ja: "移動時間が足りず、次の訪問先に時間通りに到着できません。",
  },
  group_split_risk: {
    zh: "替代项目容量不足，团队可能被拆散",
    en: "The alternative activity cannot fit the whole group; the group may have to be split.",
    ja: "代替プログラムの定員が不足しており、団体が分割される可能性があります。",
  },
  refund_penalty: {
    zh: "已过免费取消时限，取消将按条款产生费用",
    en: "The free-cancellation window has passed; cancelling now incurs a fee per the terms.",
    ja: "無料キャンセル期限を過ぎているため、規定のキャンセル料が発生します。",
  },
  replaced_by_fallback: {
    zh: "已启用替代项目，后续环节相应顺延",
    en: "An alternative activity has been arranged; later stops shift accordingly.",
    ja: "代替プログラムを手配しました。以降の行程は順次繰り下がります。",
  },
  on_track: {
    zh: "行程正常，按计划前往",
    en: "On track — proceed as planned.",
    ja: "行程は正常です。予定通り移動してください。",
  },
  no_alternative: {
    zh: "没有可用的替代项目",
    en: "No suitable alternative activity is available.",
    ja: "利用できる代替プログラムがありません。",
  },
};

/** 按团队语言顺序取第一条可用文案，兜底中文。 */
export function localize(reasonCode, languages) {
  const entry = REASONS[reasonCode];
  if (!entry) return reasonCode;
  for (const lang of languages ?? []) {
    if (entry[lang]) return entry[lang];
  }
  return entry.zh;
}

/** 一次取全部所需语言的文案，供导游端并排展示。 */
export function localizeAll(reasonCodes, languages) {
  const langs = [...new Set([...(languages ?? []), "zh"])];
  return reasonCodes.map((code) => ({
    code,
    messages: Object.fromEntries(langs.map((lang) => [lang, REASONS[code]?.[lang] ?? REASONS[code]?.zh ?? code])),
  }));
}
