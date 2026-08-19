# PRD：API 用量监控常驻插件（api-monitor）

> 状态：已批准（2026-08，plan mode 审核通过）。交由创造模式（cordis preset）执行。
> 实现时遵循官方 `cordis-plugin-development` 技能：先 cordis_inspect 核对真实服务签名与槽位契约，再写代码。

## 1. 目标与成功标准

在 DSH Web GUI 中提供**常驻的 API 用量监控**：监控 DeepSeek / SiliconFlow 余额、OpenCode Go 与火山方舟 Coding Plan 订阅配额（5小时/周/月三窗口）、以及当前会话树（主会话 + 全部子代理）的 token 用量与花费。

**成功标准**：
1. 侧边栏**设置按钮上方**出现入口，显示 4 行摘要，每 60s 自动刷新，数值与各官方控制台一致。
2. 点击入口弹出**开始菜单式浮动窗**（向右上角展开、点击其他区域/Esc 自动关闭），内含 6 个区块（DeepSeek / SiliconFlow / OpenCode Go / 火山 Coding Plan / 火山 Agent Plan / 会话总览）。
3. 会话用量 = 当前主会话 + 其所有子代理（`ctx.subagents.listDescendants` 枚举会话树）汇总，按供应商拆分。
4. 全部配置通过 DSH 官方机制（`.credentials.yaml` + `settings.yaml` 命名空间），插件不建额外配置文件。
5. 页面刷新后可重新加载 client 半段；DSH 重启后可从工作区保存的源码一键重新定义恢复（见 §8）。

## 2. 总体架构

**DSH 动态双半段 Cordis 插件**（`cordis_define` + `cordis_run`，纯 JS、无构建）：

- **Host 半段**（code.host）：常驻服务。60s 轮询 4 家 API、计算会话树用量与花费、维护快照缓存；向 client 暴露 RPC（host.call）并推送更新事件。
- **Client 半段**（code.client）：React（React.createElement）注册：
  - `sidebar.footer.action` 槽（list，渲染于设置按钮**上方**）→ 4 行摘要入口；
  - 入口点击弹出的浮动窗（5 区块）。

## 3. 数据源与 API 契约（均已核实）

| 项 | 请求 | 鉴权 | 响应要点 | 轮询 |
|---|---|---|---|---|
| DeepSeek 余额 | `GET https://api.deepseek.com/user/balance` | `Authorization: Bearer <key>` | `{is_available, balance_infos:[{currency,total_balance,granted_balance,topped_up_balance}]}`，可能同时含 CNY 与 USD；**优先 CNY** | 60s |
| SiliconFlow 余额 | `GET https://api.siliconflow.cn/v1/user/info` | `Authorization: Bearer <key>` | `data:{balance, chargeBalance, totalBalance}`（CNY） | 60s |
| OpenCode Go 配额 | `GET https://opencode.ai/zen/go/v1/usage` | **同时**带 `Authorization: Bearer` 与 `x-api-key` 两个头 + 浏览器 UA（网关拦默认 UA） | `usage:{rolling:{percent,resetsAt}, weekly:{...}, monthly:{...}}`，percent 0–100 已用%；配额 $12/$30/$60 | 60s |
| 火山 Coding Plan 配额 | `POST https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Region=cn-beijing&Version=2024-01-01`（query 按 key 字母序） | **火山 SigV4**（HMAC-SHA256 变体），独立 AK/SK；**推理 Bearer Key 不可用**（`InvalidAuthorization`） | `Result.QuotaUsage[]`：`Level`(5h/session/weekly/monthly)、`Percent`、`ResetTime/ResetTimestamp`（秒）；防御式解析 | 60s |
| 火山套餐档位 | 同网关 `Action=ListSubscribeTrade`（`ResourceNames` 探个人版） | 同 AK/SK | 返回 `tier`（coding-plan=lite/pro，agent-plan=small/medium/large/max）；实测不返回 → 回退设置档位 | 随配额 |
| 火山 Agent Plan 配额 | 同网关 `Action=GetAFPUsage` | 同 AK/SK | `Result.AFPFiveHour/AFPWeekly/AFPMonthly` 各含 `Quota/Used/ResetTime`（绝对额度）；`Quota<=0` 视为该窗口未启用跳过 | 60s |

**火山 SigV4**：参考 cc-switch `src-tauri/src/services/coding_plan.rs`——算法串 `HMAC-SHA256`、SignedHeaders 固定顺序 `host;x-date;x-content-sha256;content-type`、credential scope 以 `request` 结尾、SK 不加 `AWS4` 前缀、canonical query 按字母序。沙箱若无 crypto（用 `Builtin.listBuiltins` 确认）→ 内嵌纯 JS SHA-256+HMAC（约百行）。

**用量语义**：接口返"已用 %"，展示"剩余 %" = 100 − used，顺序恒为 `5小时 | 1周 | 1月`。

## 4. 配置（DSH 官方机制）

**凭据（零新增）**：`ctx.credentials.resolve(credentialRef(...))` 读取：`DEEPSEEK_API_KEY`、`SILICONFLOW_API_KEY`、`VISION_API_KEY`（OpenCode Go）、`VOLCES_API_KEY`（推理 Key，配额查询不用）。缺失 → 该区块"未配置"。

**settings.yaml 命名空间 `api-monitor`**（`ctx.settings.register('api-monitor', schema)`，Settings 窗口自动渲染表单）：
- `volcesAccessKeyId` / `volcesSecretAccessKey`：`role('secret')` 脱敏（用户已提供；PRD 不回显密钥）。
- `volcesTier`：`auto|lite|pro`，默认 `auto`；浮动窗下拉直接写回。
- `pollIntervalSeconds`=60；阈值 `warnPercent=70`、`dangerPercent=90`、`balanceWarn=10`。
- `priceTable`：可选单价表覆盖（§6.3）。
- `showCacheHitRate=true`、`showResetTime=false`（次要信息默认 tooltip）。
- `entryVisibility`：各区块【显示在按钮上】勾选状态，`{deepseek:true, siliconflow:true, opencodeGo:true, volcesCoding:true, volcesAgent:true}`，默认全选。
- 火山 key 配置按钮（浮动窗内）点击输入 AK/SK → host 经 `ctx.settings.update` 写入 `volcesAccessKeyId/volcesSecretAccessKey`（两个子区块共享同一份，配一次两者都生效）。

## 5. UI 设计（用户规格）

### 5.1 入口（sidebar.footer.action，设置按钮上方）
行数**自适应**：每个可见且勾选【显示在按钮上】的区块各占一行（默认 5 行，短标签 + 数值）：
- DeepSeek：余额 `¥13.43`（<¥10 标红）
- SiliconFlow：余额 `¥88.88`
- OpenCode Go：`50%|20%|80%`（5h|周|月 剩余%）
- 火山C：Coding Plan `45%|30%|70%`
- 火山A：Agent Plan `55%|50%|90%`
色标：绿<70%、黄 70–90%、红 ≥90%；rail 收起时退化为图标。入口高度由自身组件自适应；若侧栏布局受限，由各区块【显示在按钮上】勾选框控制哪些行出现在入口（`entryVisibility` 持久化）。

### 5.2 浮动窗（点击入口弹出；向右上角展开；点外部/Esc 关闭）
6 区块自上而下：

① **DeepSeek**：`余额 (CNY) | ¥13.43`；`本次会话token | 输入 0 · 缓存读 0 · 输出 0`；`本会话花费 | ¥0.00`
② **SiliconFlow**：同上三行（余额=totalBalance）
③ **OpenCode Go**：`用量剩余 | 5小时 x% / 1周 x% / 1月 x%`；`本次会话token | 输入 0 · 缓存读 0 · 输出 0`
④ **火山 Coding Plan**：`用量剩余 | 5小时 x% / 1周 x% / 1月 x%`；`本次会话次数 | x`；【下拉：lite/pro/自动】| key配置
⑤ **火山 Agent Plan**：`用量剩余 | 5小时 x% / 1周 x% / 1月 x%`（GetAFPUsage 折算剩余%）；`本次会话次数 | x`；【下拉：small/medium/large/max/pro】| key配置；`本次会话token | 输入 0 · 缓存读 0 · 输出 0`
⑥ **本次会话总览**：`token用量 | 输入 0 · 缓存读 0 · 输出 0`；`调用次数 | x`；+派生行 `缓存命中率 x%`（= cacheRead/(uncachedInput+cacheRead)，默认显示可隐藏）

**浮动窗底部按钮【读取套餐】**：立即重拉全部 4 家数据 + 重新探测火山订阅档位（ListSubscribeTrade → lite/pro、small/medium/large/max 自动识别）。

- ⑥ = 会话树全供应商汇总；①–⑤ 的"本次会话"行 = 按供应商拆分的同一会话树口径。
- **key配置**（④⑤ 共用）：点击弹出输入框要求输入 AK/SK → 保存到 `api-monitor` 命名空间；配一次，Coding Plan 与 Agent Plan 同时生效。
- **容错**：区块可见性只看"模型登录 key 是否存在"（火山区块看 VOLCES_API_KEY）；key 存在即显示，接口失败在区块内显示错误 + 保留上次成功值，不隐藏。火山 AK/SK 缺失时，④⑤ 显示 key配置按钮 + 空数据。
- 每个区块（含①–⑥）带勾选框【显示在按钮上】（默认勾选，持久化于 entryVisibility）。
- 会话次数/token 的火山归属按请求端点族拆分：baseURL 含 `/api/coding` → Coding Plan 桶，含 `/api/plan` → Agent Plan 桶；无法区分时归入 Coding Plan。
- 每区块状态点/错误提示：未配置、接口错误（保留上次值）、火山 AK/SK 无效提示。

## 6. 会话用量计算（host）

### 6.1 会话树
client 经 client sessions/workspaces 服务取当前活动会话 id（inspect 确认）；host 用 `ctx.subagents.listDescendants(rootSessionId)` 展开（含 parentId/depth）+ 主会话本身；无子代理退化为单会话。

### 6.2 token 与请求次数
- 每会话总量：`ctx.tokenMeter`（measure）与 `ctx.sessionProjections` 的 `tokenUsage`（uncachedInput/output/cacheRead/cacheWrite）。
- 按供应商拆分：遍历会话 surface/事件，按 assistant 消息的 provider/model 归属分桶；请求次数 = 各桶成功 assistant 请求数。
- 全树求和；快照 TTL 5–10s（避免高频重扫大会话树）。

### 6.3 花费（仅 DeepSeek/SiliconFlow）
`cost = uncachedInput×P_in + cacheRead×P_cr + cacheWrite×P_cw + output×P_out`（每 1M tokens）。
单价表实现时以官方最新价播种用户实际使用的对话模型（DeepSeek V4 系列；SiliconFlow 常用项），`priceTable` 可覆盖；未知名模型 → `—`。订阅两家不显示花费。

## 7. 数据流

- Host：`ctx.setInterval` 60s 轮询（每家独立容错：失败保留上次值 + 错误状态 + 耗时）；token/花费快照 client 拉取时计算（TTL）。
- Client：`host.call('getSnapshot')` 5–10s 轮询渲染；入口 4 行同一快照。host 广播 `monitor/updated`（实现时确认动态插件事件通道，无则纯轮询）。
- 会话切换：client 检测活动会话变化 → 重新拉取（新 rootSessionId）。

## 8. 生命周期与持久化

- 页面刷新：host 持续运行；client 经 cordis 面板"load"重新加载（文档化）。
- **DSH 重启（已知限制）**：动态插件存于进程内存，重启消失。缓解：源码落盘 `/mnt/d/DSH/plugins/api-monitor/{host.js,client.js,README.md}`，README 附一键 `cordis_define`+`cordis_run` 恢复步骤；配置/凭据天然持久于 `~/.dsh/settings.yaml` / `.credentials.yaml`。

## 9. 安全

- 火山 Secret 仅写 settings.yaml（0600，secret 脱敏，wire 用 redactSecrets），代码/PRD 不回显。
- 已建议：Secret 曾出现在对话中，配置后可去控制台轮换一次。
- 密钥一律经 ctx.credentials / ctx.settings，插件无自有存储。

## 10. 边界与失败模式

| 场景 | 行为 |
|---|---|
| 任一凭据缺失/无效 | 该区块"未配置/无效"，其余照常 |
| OpenCode Go 401/403 | 提示"API Key 无效"（排查双头+UA） |
| 火山鉴权失败 | 提示检查 AK/SK 与 IAM 用量查询权限；tier 识别失败用设置档位 |
| 火山某 plan 未订阅 | 对应子区块显示"未订阅"占位（用量行隐藏），另一子区块正常 |
| 入口行数超限 | 高度自适应；受限时由【显示在按钮上】勾选控制 |
| 接口字段变动 | 防御式解析（多候选字段名），原始响应截断入日志 |
| 余额 USD/CNY | 优先 CNY，无 CNY 才 USD |
| 未知名模型 | 花费显示 `—` |
| 无子代理 | 退化为仅主会话 |
| 大会话树 | 快照 TTL + 有界单次扫描 |
| 侧边栏收起 | 入口退化为图标 |
| 沙箱无 crypto | 内嵌纯 JS SHA-256/HMAC |
| 页面刷新/多页 | 各页独立加载 client 半段，host 单实例 |

## 11. 实现步骤（创造模式执行）

1. cordis_inspect：tokenMeter/sessionProjections、sessions、subagents（listDescendants）、settings、credentials、网络服务（web.fetch 或 ctx.http）、Builtins（crypto 可用性）、sidebar.footer.action 槽契约、client 活动会话取值。
2. 用真实 key 各调一次 4 家 API（重点：火山 ListSubscribeTrade + GetCodingPlanUsage 真实响应结构）。
3. Host：settings 命名空间、60s 轮询器、4 个 fetch 适配器、火山 SigV4（WebCrypto 或纯 JS）、会话树聚合（按供应商 token/次数/花费）、快照缓存、RPC。
4. Client：入口（4 行+色标+rail 态）、浮动窗（5 区块+右上展开+点外部/Esc 关闭+档位下拉+状态点）。
5. 写入 settings（火山 AK/SK 等），cordis_define + cordis_run，页面验证迭代。
6. 源码落盘 /mnt/d/DSH/plugins/api-monitor/ + 恢复 README。
7. 对照官方控制台验收（§12）。

## 12. 验收标准

- 入口 4 行与官方控制台一致（DeepSeek/硅基余额、opencode.ai dashboard、火山控制台用量）。
- 浮动窗 6 区块逐行核对；两处档位下拉可切换并持久化；key配置按钮输入后两子区块同时生效；【读取套餐】触发全量刷新+档位识别。
- 会话树汇总正确：开子代理后 ⑤ 与①–④ 对应行同步增长；花费按单价表正确。
- 设置窗口可编辑全部字段；Secret 不回显。
- 页面刷新 client 可重载；README 重启恢复流程走通。

## 13. 假设与待确认

- "本次会话" = 主会话 + 全部子代理汇总（已确认）。
- 缓存命中率行（⑤）为新增派生显示，可关闭。
- 重置时间/$ 配额等次要信息默认 tooltip（showResetTime 可关）。
- 单价表以实现时官方价播种、可覆盖。
- 线级 API/服务形状以 inspect + 实测为准（接口契约已由开源实现交叉验证：cc-switch / ark-cli / OpenCodeMonitor）。