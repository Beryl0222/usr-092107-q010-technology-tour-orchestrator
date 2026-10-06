# 科技研学演示编排器

本仓库记录该项目已确认的领域对象、事件名称和基础校验方式，便于不同系统交换一致的数据，并提供动态编排引擎与三类数据最小化视图。

## 资料范围

- `contracts/domain.schema.json`：领域事件信封、聚合类型与事件名称。
- `data/sample.json`：一条用于本地联调的中文样例。
- `data/scenario.json`：外籍研学团深圳一日完整场景（含重复回执、缺签成员）。
- `src/validator.js`：事件信封校验（必填、枚举、事件与聚合搭配、逐人签署规则）。
- `src/orchestrator.js`：编排引擎——事件归约、门槛评估、动态重排、导游端下一站。
- `src/reasons.js`：变更原因码的中 / 英 / 日文案。
- `src/views.js`：导游端、企业接待、运营复盘三类视图。
- `tests/`：验证样例、引擎行为与视图脱敏。

当前资料覆盖动态时段、设备许可和访客授权。记录一经接收，标识、发生时间与版本不得原地改写；更正使用新的后继记录。个人、机构及商业敏感信息仅向履行职责所需的调用方开放。

## 领域事件

| 事件 | 聚合 | 含义 |
| --- | --- | --- |
| `GROUP_PROFILED` | `visitor_group` | 团队语言、兴趣、人数、付款单与基准行程 |
| `SLOT_HELD` | `demo_slot` | 演示时段占位；预约不等于当日可执行 |
| `SLOT_PERMITTED` | `demo_slot` | 当日许可下达，自动驾驶与低空项目以此为准 |
| `DEMO_INTERRUPTED` | `demo_slot` | 设备停运、天气停飞、区域临时关闭 |
| `SAFETY_BRIEFED` | `access_clearance` | 成员逐一完成安全告知 |
| `ACCESS_CLEARED` | `access_clearance` | 成员本人签署受限区域准入，领队不得代签 |
| `FILMING_DECIDED` | `access_clearance` | 工厂拍摄权限审批结果 |
| `PAYMENT_SETTLED` | `payment_order` | 跨境付款到账，购物环节解锁 |
| `PICKUP_COMPLETED` | `pickup_task` | 商品领取完成 |
| `RECEIPT_RECORDED` | `partner_receipt` | 合作方回执，按 `partner + external_ref` 幂等去重 |
| `FALLBACK_ACTIVATED` | `itinerary_revision` | 替代项目启用 |
| `ITINERARY_REVISED` | `itinerary_revision` | 行程修订，仅涉及未发生环节 |

## 编排规则

- **占位与许可**：`SLOT_HELD` 只是占位；自动驾驶、低空飞行类环节必须有 `valid_date` 等于开场日期的 `SLOT_PERMITTED` 才可执行；`DEMO_INTERRUPTED` 后以中断原因为准。
- **逐人签署**：受限区域要求每位成员先完成安全告知再本人签署，缺一即不可进入，引擎返回缺签成员名单；代签事件直接拒绝。
- **动态重排**：迟到或故障时只处理 `end > now` 的环节。硬故障（停运、停飞、关闭、拍摄被拒）触发替换或取消；签署、付款、备货等可补齐的软门槛只列入 `pending`，不动行程。替换时核对前后转场时间、退款条款（免费取消窗口与违约金比例）与替代项目容量（不足则给出拆团风险警告）。
- **导游端下一站**：从当前位置出发，返回第一个门槛通过且转场可达的环节，附出发时间、预计到达与被跳过环节的多语种原因。
- **数据最小化**：企业视图只含到达窗口、人数、语言与签署进度计数；运营复盘只见聚合指标，企业敏感环节（`sensitive`）不进入明细，成员身份与证件信息不出现。

## 本地检查

```bash
node --test
```
