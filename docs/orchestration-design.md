# 深圳科技研学接待动态编排服务设计

面向外籍研学团的深圳科技研学接待（无人车、无人机编队、工厂研发区、机器人门店、购物与返程）。
本服务的核心命题：导游最怕到现场才发现无人车停运、无人机因风雨停飞、工厂临时关闭研发区，
因为后续门店、购物、返程会连锁失效。因此所有要素都进入同一份行程计算，任何变化立即重排尚未发生的部分。

## 1. 设计目标

1. 团队语言与兴趣、演示时段、设备状态、操作员资质、安全告知、访客证件、工厂拍摄权限、
   跨境付款、商品领取、替代项目，全部作为行程计算的输入，而不是事后人工核对。
2. 预约只是占位：自动驾驶与低空项目以**当日许可**为准，许可未签发前环节不进入"可执行"集合。
3. 进入受限区域按人员**逐一签署**，领队不得代签。
4. 迟到或故障时只重排尚未发生的环节，并同时核对转场时间、退款条款、团队是否会被拆散。
5. 导游端在每个节点给出**此刻真正可执行的下一站**及多语种变更原因。
6. 最小知情：企业只收到接待所需信息；运营方复盘转化时看不到企业敏感资料。

## 2. 上下文地图

| 上下文 | 聚合 | 职责 |
| --- | --- | --- |
| 团队与成员 | `visitor_group`、`access_clearance`（按成员） | 语言、兴趣、证件、安全告知、受限区域签署 |
| 资源与许可 | `demo_slot`、`device_asset`、`operator`、`day_permit`、`filming_permit` | 时段占位、设备状态、操作员资质、当日许可、拍摄权限 |
| 交易 | `payment_order`、`pickup_order` | 跨境付款与退款、商品领取 |
| 编排 | `fallback_program`、`itinerary_revision` | 替代项目目录、重排结果 |
| 协同 | `partner_receipt` | 合作方回执（沿用同一事件信封，幂等去重） |
| 分析 | （只读投影，无聚合） | 参观→购买→产业对接转化复盘，脱敏后输出 |

## 3. 事件目录

所有事件共用 `contracts/domain.schema.json` 定义的信封
（`event_id` / `event_type` / `aggregate_type` / `aggregate_id` / `occurred_at` / `version` / `summary`，
可选 `causation_id` / `supersedes` / `actor` / `payload`）。

| 事件 | 聚合 | 产生者 | 关键 payload | 主要消费者 |
| --- | --- | --- | --- | --- |
| `GROUP_PROFILED` | visitor_group | 组团社对接 | 语言列表、兴趣标签、人数、是否允许拆团 | 编排引擎、导游端 |
| `SLOT_HELD` / `SLOT_RELEASED` | demo_slot | 编排引擎 | 时段、场地、供应商、退款政策引用 | 重排器、合作方 |
| `DAY_PERMIT_ISSUED` / `DAY_PERMIT_REVOKED` | day_permit | 许可对接（空域/道路） | 许可范围、有效时段、气象依据 | 可执行闸门 |
| `DEVICE_STATUS_CHANGED` | device_asset | 运维遥测 | 设备、状态（online/offline）、原因 | 可执行闸门、重排器 |
| `OPERATOR_QUALIFICATION_VERIFIED` | operator | 资质核验 | 操作员、资质项、有效期 | 可执行闸门 |
| `VISITOR_DOCUMENT_VERIFIED` | access_clearance | 准入核验 | 成员、证件类型、核验结论（不含证件号码） | 准入服务 |
| `SAFETY_BRIEFING_ACKED` | access_clearance | 导游端 | 成员、告知版本、确认时间 | 准入服务 |
| `RESTRICTED_AREA_SIGNED` | access_clearance | 导游端 | `member_id`、`signer_id`（必须相等）、区域 | 准入服务 |
| `ACCESS_CLEARED` | access_clearance | 准入核验 | 成员、已齐套的准入项 | 可执行闸门 |
| `FILMING_PERMIT_GRANTED` / `FILMING_PERMIT_REVOKED` | filming_permit | 企业对接 | 厂区、可拍范围、限制条款 | 导游端、企业端 |
| `PAYMENT_SETTLED` / `REFUND_ISSUED` | payment_order | 支付清算 | 订单、币种、结算/退款金额、汇率 | 重排器、复盘投影 |
| `PICKUP_READY` / `PICKUP_COMPLETED` | pickup_order | 门店/口岸仓 | 商品、领取点、领取窗口 | 编排引擎、导游端 |
| `DEMO_INTERRUPTED` | demo_slot | 可执行闸门 | 环节、原因码（天气/设备/许可/区域关闭） | 重排器 |
| `FALLBACK_ACTIVATED` | fallback_program | 重排器 | 替代项目、被替换环节 | 导游端、合作方 |
| `ITINERARY_REVISED` | itinerary_revision | 重排器 | `reason_code`、`reason_i18n`、变更清单 | 导游端、企业端 |
| `PARTNER_RECEIPT_RECORDED` | partner_receipt | 合作方网关 | `receipt_of`（原事件 id）、受理结论 | 各生产方 |

## 4. 核心规则

**R1 预约即占位，当日许可为准。** `SLOT_HELD` 只锁定时段；自动驾驶与低空项目只有在当日
`DAY_PERMIT_ISSUED` 到达后才进入"可执行"集合。风雨、空域管制触发 `DAY_PERMIT_REVOKED` +
`DEMO_INTERRUPTED`，重排器立即介入，而不是等导游到场发现。

**R2 准入四件套，按人核验。** 成员可进入环节前需齐：证件核验、安全告知确认、受限区域本人签署
（`signer_id` 必须等于 `member_id`，校验器强制，领队代签直接拒绝）、涉及厂区的拍摄权限。
四件齐套后准入服务才发 `ACCESS_CLEARED`。

**R3 记录不可变。** 事件只追加；标识、发生时间、版本不得原地改写；更正用带 `supersedes`
的后继事件；因果关系用 `causation_id` 串联（如 `DEMO_INTERRUPTED` → `ITINERARY_REVISED`）。

**R4 回执幂等。** 合作方回执沿用同一信封：`event_id` 全局唯一，`payload.receipt_of` 指向原事件。
消费方按 `event_id` 去重——合作方重试、网络重发产生的重复回执只记录、不重复生效。

**R5 重排三核对。** 每次重排同时核对：转场时间（场地间分钟数矩阵）、退款条款
（按通知提前量取免费/迟到/爽约三档比例）、团队拆散（替代项目容量不足且团队不允许拆分时，
宁可取消也不拆团，原因码 `GROUP_SPLIT_BLOCKED`）。

**R6 只动未来。** 已结束或进行中的环节锁定，重排只触碰尚未发生的部分；历史环节如需更正，
走 R3 的后继事件，不改写原记录。

**R7 交易参与编排。** 购物环节以 `PAYMENT_SETTLED`（跨境付款已结算）为前置；商品领取环节以
`PICKUP_READY` 为前置。返程提前导致领取窗口冲突时，领取点切换（口岸自提/邮寄）作为该环节的
替代方案进入同一次重排，退款按 R5 的条款一并算出。

## 5. 重排器

实现见 `src/replan.js`（纯函数），原因文案见 `src/reasons.js`。

```
输入：now、按开始时间排序的环节列表、替代项目目录、转场分钟数矩阵、
      供应商退款政策、是否允许拆团、团队人数、团队语言列表
输出：重排后环节列表、变更清单（类型 + 原因码 + 多语种原因）、退款清单

步骤：
1. 锁定已结束/进行中的环节（R6）。
2. 对中断环节：按兴趣标签匹配替代项目，依次检查时间窗、容量（R5 拆团核对）、
   从前一保留环节的转场可达性；命中则替换（FALLBACK_ACTIVATED），否则取消并计退款。
3. 对后续环节：以上一个保留环节为锚点重算到达时间；到达晚于开始则先顺延，
   顺延越过硬性结束时间（场地关闭/返程死线）才取消，原因码 TRANSFER_INFEASIBLE。
4. 每个被取消环节按供应商政策计算退款比例（R5 退款核对）。
5. 汇总为一条 ITINERARY_REVISED 事件，causation_id 指向触发事件，
   reason_i18n 覆盖团队全部语言（缺语种回退中文）。
```

## 6. 导游端"此刻可执行的下一站"

每个节点（到达、离场、收到事件推送）重新计算：

```
可执行(环节) = 未过最后入场时间
  ∧ (需当日许可 ⇒ 最新许可事件为 ISSUED)
  ∧ 所需设备最新状态为 online
  ∧ 所需操作员资质在有效期内
  ∧ 全员准入四件套齐套（按环节要求的子集）
  ∧ 从当前位置转场可达
```

取可执行环节中最早者为推荐下一站；被跳过的每个环节附 `reason_code` + `reason_i18n`，
导游对客解释与系统记录口径一致，不会出现"导游现场编理由"。

## 7. 数据可见性矩阵

| 数据项 | 导游 | 接待企业 | 运营复盘 | 支付清算 |
| --- | --- | --- | --- | --- |
| 团号、人数、语言、兴趣标签 | ✔ | ✔ | 脱敏后 ✔ | ✖ |
| 行程与实时变更原因 | ✔ | 仅本企业环节 | 脱敏后 ✔ | ✖ |
| 成员证件号码 | 仅核验状态 | ✖（仅准入齐套计数） | ✖ | ✖ |
| 安全告知与签署记录 | 状态 | 状态计数 | ✖ | ✖ |
| 拍摄权限与限制条款 | ✔ | ✔（本企业） | ✖（企业敏感） | ✖ |
| 支付金额与退款 | 状态 | ✖ | 汇总区间 | ✔ |
| 商品领取与购买转化 | ✔ | ✖ | 匿名漏斗 | ✖ |
| 研发区关闭原因 | 对客话术版 | ✔ | ✖（企业敏感） | ✖ |

复盘投影把团队标识替换为匿名群组、企业标识替换为行业类别后再输出；
参观→购买→产业对接的转化链路可算，但任何一步都回不到具体企业与具体个人。

## 8. 主流程时序

1. 组团社建档 `GROUP_PROFILED`（语言、兴趣、人数、可否拆团）。
2. 编排引擎按兴趣占位 `SLOT_HELD`，并为每个占位登记替代项目候选。
3. 前夜：设备状态、操作员资质、企业拍摄权限同步入库。
4. 当日早晨：许可闸门等待 `DAY_PERMIT_ISSUED`；未签发的自动驾驶/低空环节保持"占位待许可"。
5. 集合后逐人完成证件核验、安全告知、受限区域签署（R2），齐套发 `ACCESS_CLEARED`。
6. 执行中：天气突变 → `DAY_PERMIT_REVOKED` + `DEMO_INTERRUPTED` → 重排器产出
   `ITINERARY_REVISED`（多语种原因）→ 导游端刷新下一站 → 合作方回执确认（R4 幂等）。
7. 购物与领取：支付结算、领取就绪事件驱动对应环节进入可执行集合（R7）。
8. 结束后：复盘投影输出脱敏转化漏斗；退款按重排结果自动生成 `REFUND_ISSUED`。

## 9. 仓库落点

| 文件 | 内容 |
| --- | --- |
| `contracts/domain.schema.json` | 事件信封与全部事件/聚合枚举 |
| `src/domain.ts` | 信封与关键 payload 的 TypeScript 类型 |
| `src/validator.js` | 信封校验 + 逐类型约束（本人签署、回执指向、多语种原因） |
| `src/replan.js` | 第 5 节重排器的可执行实现 |
| `src/reasons.js` | 原因码目录与中/英/日文案 |
| `data/sample.json`、`data/sample-itinerary-revised.json` | 联调样例 |
| `tests/` | 契约校验与重排规则测试（`node --test`） |
