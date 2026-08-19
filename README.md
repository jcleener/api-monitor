# api-monitor

> DSH（DeepSeek Harness）插件：**常驻 API 用量监控**。
> 侧边栏底部常驻摘要 + 独立浮动窗，实时查看 DeepSeek / SiliconFlow 余额、OpenCode Go 与火山引擎（Coding Plan / Agent Plan）订阅配额，以及当前会话树（主会话 + 全部子代理）的 token 用量与花费。

## 功能

- **余额与配额监控**：
  - DeepSeek — `GET api.deepseek.com/user/balance`
  - SiliconFlow — `GET api.siliconflow.cn/v1/user/info`
  - OpenCode Go — `GET opencode.ai/zen/go/v1/usage`
  - 火山引擎 — `GetCodingPlanUsage` / `GetAFPUsage`（SigV4 签名，service = `ark`）
- **会话树用量**：统计主会话与全部子代理的 token 用量与花费（价格表可配置，`priceTable` 覆盖）
- **入口**：侧边栏底部 `.footArea`（Cordis 面板按钮上方）。宽侧栏显示**竖排多行摘要**（每家一行：状态色点 + 名称 + 数值，行数由「显示在入口」勾选控制）；侧栏收起（rail）时退化为圆形图标；点击弹出 **Cordis 风格浮动窗**（标题栏 + ✕ 关闭 + Esc 关闭 + 遮罩点外关闭）
- **轮询**：默认 60s 可配置；拉取失败时**保留上次成功值**（stale-while-revalidate，弱化显示并标注获取时间）
- **凭据**：经 `ctx.credentials.resolve()` 读取 `DEEPSEEK_API_KEY` / `SILICONFLOW_API_KEY` / `VISION_API_KEY` / `VOLCES_API_KEY`

## 状态灯配色

| 场景 | 颜色 |
|---|---|
| DeepSeek / SiliconFlow 余额 **< `balanceWarn`（默认 10 元）** | 🔴 红 |
| 周期用量（OpenCode Go / 火山 Coding / 火山 Agent）**剩余 ≤ 10%**（0% = 用尽） | 🔴 红 |
| 周期用量**剩余 ≤ 30%**（预警） | 🟡 黄 |
| 其余正常 | 🟢 绿 |

> 周期用量显示的是**剩余百分比**（100 − 已用），按三个窗口（5小时/周/月）中**最低的剩余**决定颜色——任一窗口告急即亮警示。

## 安装

在目标电脑的 DSH 环境执行：

```bash
dsh plugin --profile web add "github:jcleener/api-monitor"
```

或固定版本：

```bash
dsh plugin --profile web add "github:jcleener/api-monitor#v0.1.2"
```

安装后重启 `dsh web`，侧边栏底部即出现监控入口。插件为**静态常驻**：随 DSH 启动自动加载，无需在 Cordis 面板中手动启用/授权，配置持久化于 `~/.dsh/settings.yaml` 与 `.credentials.yaml`。

> 早期「手动粘贴到 Cordis 面板」的动态版源码与恢复步骤保留在 [`legacy/`](./legacy/)，已不推荐使用。

## 配置

设置命名空间 `api-monitor`（DSH 设置页或 `~/.dsh/settings.yaml`）：

| 键 | 默认 | 说明 |
|---|---|---|
| `volcesAccessKeyId` / `volcesSecretAccessKey` | 空 | 火山引擎 AK/SK（**配额查询专用**，与推理用 `VOLCES_API_KEY` 不同；`role('secret')` 脱敏） |
| `volcesTier` | `auto` | 火山档位（`auto`/`lite`/`pro`，Agent Plan 另含 `small/medium/large/max`） |
| `pollIntervalSeconds` | `60` | 轮询间隔（秒） |
| `warnPercent` / `dangerPercent` | `70` / `90` | 已用%阈值（用于推算剩余%的告警/危险档） |
| `balanceWarn` | `10` | 余额预警阈值（元） |
| `priceTable` | `{}` | 模型价格表（`{ "模型ID": { pi, pcr, pcw, po } }`，每 1M tokens USD） |
| `showCacheHitRate` / `showResetTime` | `true` / `false` | 是否显示缓存命中率 / 重置时间 |
| `entryVisibility.*` | `true` | 各供应商是否显示在入口 |

### 火山引擎 AK/SK 配置

1. 在浮动窗的「火山 Coding Plan」/「火山 Agent Plan」区块点 **key配置**，输入 AccessKey ID 与 SecretKey，保存（两区块共用一份）。
2. 保存后立即重拉配额；若鉴权失败，区块会显示 `ResponseMetadata.Error` 中的具体错误（如 `SignatureDoesNotMatch` / `AccessDenied`）。
3. 需要 IAM 具备用量查询权限；SigV4 使用 `region=cn-beijing`、`service=ark`。

### 关于 SiliconFlow 余额

硅基流动新云平台（cloud.siliconflow.cn）的网页钱包余额**不通过 API 暴露**：`/v1/user/info` 仅反映 API-key 归属账号的旧口径余额。插件显示的是接口真实返回值；网页上的 45+ 之类的余额请以控制台为准。

## 工作原理

- **Host 半段**（`lib/index.js`）常驻 dsh web 进程：
  - 注册 `api-monitor` 配置命名空间（真实 schemastery schema，`role('secret')` 原生脱敏）；
  - 60s 轮询 5 家数据（原生 `fetch`；火山 SigV4 用 `crypto.subtle` 计算 HMAC-SHA256）；
  - 聚合会话树 token/花费（`sessionProjections.tokenUsage` + `assistant/message` 事件按供应商分桶）；
  - 经 `webServer.register` 暴露同源路由：`/api-monitor/snapshot|config|refresh|set-volces-keys|set-tier|set-visibility`。
- **Client 半段**（`lib/client.js`）以 `window.__ModuleLoader__.load` factory 加载，注册 `sidebar.footer.action` 槽（order -20），数据经 fetch 同源路由获取。

## 开发 / 结构

```
lib/index.js      Host 半段（ESM，原生 fetch + crypto.subtle）
lib/client.js     Client 半段（__ModuleLoader__ factory，React.createElement）
cordis.patch.yml  加载器补丁层（insert 声明）
package.json      包清单（dsh.client 声明浏览器端打包）
PRD.md            产品需求文档
legacy/           早期动态版源码
```

本地联调：改动 `lib/` 后 HMR 热载（客户端 CSS/JS 变更约 1s 生效）；宿主代码与补丁层变更需重启 `dsh web`。

## 更新日志

### v0.1.2

- **修复状态灯方向**：周期用量（OpenCode Go / 火山 Coding / 火山 Agent）按**剩余%**上色——剩余 ≤10% 红、≤30% 黄、否则绿（此前按剩余越高越红，与"0% = 用尽"语义相反）。

### v0.1.1

- **stale-while-revalidate**：数据拉取中或失败时，保留并显示**上次成功读取的数据**（弱化显示并标注「↑ 显示上次数据（HH:MM 获取）」），恢复成功后自动切回实时。

### v0.1.0

- 首个公开版本：常驻 API 用量监控（DeepSeek / SiliconFlow / OpenCode Go / 火山引擎 余额与配额、会话树 token 与花费，侧边栏入口 + 独立浮动窗）。

## 许可证

MIT © 2025 [jcleener](https://github.com/jcleener)
