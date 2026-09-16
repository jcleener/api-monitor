# api-monitor · 常驻 API 用量监控

> 一个常驻的「我还有多少钱 / 还剩多少额度」面板：侧边栏底部一个「⛽ API 用量」竖排入口，
> 点开是一扇 Cordis 风格的浮动窗，里面同时显示 DeepSeek 余额、GLM Coding Plan 配额、
> OpenCode Go 用量、火山 Coding / Agent Plan 配额，以及**当前会话树**的 token 与花费。
>
> 宿主半（`lib/index.js`）活在 dsh web 进程里，负责轮询各家接口 + 聚合会话用量，
> 并通过同源 HTTP 路由 `/api-monitor/*` 把数据交给浏览器半（`lib/client.js`）。

## 特性

- **一个入口看全部**：侧边栏底部竖排摘要（每个供应商一行 + 状态点），点开浮动窗看明细。
- **5 路供应商轮询**：DeepSeek 余额、GLM（智谱 / Z.ai）配额、OpenCode Go 用量、
  火山 Coding Plan（`GetCodingPlanUsage`）、火山 Agent Plan（`GetAFPUsage`）。
- **stale-while-revalidate**：每轮轮询从上一轮结果起步，接口超时/失败时面板显示
  「↑ 显示上次数据（时间 获取）」而不是占位横杠。
- **会话树用量与花费**：根会话 + `subagents.listDescendants()` 的子代理会话一起折叠；
  总量取 token-meter 的 `tokenUsage` 投影口径，按来源（provider/model）分桶，仅 DeepSeek 计价。
- **峰谷分时计价**：按每次 `assistant/message` 事件自带的 `time` 判定高峰/空闲
  （北京时间周一至周五 9:00-12:00、14:00-18:00 为高峰），高峰/空闲分别给出用量与金额。
- **官方价格自动抓取**：正则解析 DeepSeek 中文定价页，6 小时 TTL；解析失败或数字不合理时
  保留内置价目表，不回退成错误数字。
- **零第三方依赖**：仅 Node 内置能力（`fetch` / `crypto.subtle`）与 `@deepseek-ai/schemastery`；
  火山签名用 `crypto.subtle` 手写 SigV4。

## 启用方式

`cordis.patch.yml` 是 bundle patch 层，内容就是一行挂载：

```yaml
- insert:
    - id: api-monitor
      name: api-monitor
```

- **宿主依赖的服务**：`apply()` 内 `ctx.inject([...])` 要求
  `settings` / `credentials` / `subagents` / `sessions` / `sessionProjections` / `webServer`
  六者齐备，否则宿主半不激活、路由也不注册。
- **浏览器半发现**：靠 `package.json` 的 `dsh.bundle.patch` 与 `dsh.client`
  （`platform: "web"`），浏览器半从 `exports["./client"]` 载入。
- 把包放进 profile 的 `node_modules` 并追加上面的 insert 行后，**需要重启实例**；
  浏览器半与宿主半一样随实例加载（本仓库未附带安装脚本）。
- 改动 `pollIntervalSeconds` 后需再次重启：轮询定时器在 `apply()` 时按当时的配置值建立一次。

## 配置项

宿主 `settings.register('api-monitor', SCHEMA)` 注册的 schema：

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `volcesAccessKeyId` | string | `''` | 火山引擎 AccessKey ID（Coding 与 Agent Plan 共用） |
| `volcesSecretAccessKey` | string（secret） | `''` | 火山引擎 SecretKey |
| `volcesTier` | string | `'auto'` | 套餐档位；**仅保存与回显**，代码中未见用于任何请求 |
| `pollIntervalSeconds` | number | `60` | 轮询间隔秒；apply 时读一次，实际下限 20 秒 |
| `warnPercent` | number | `70` | 预警阈值（已用 %，剩余 ≤ 100−该值 变黄） |
| `dangerPercent` | number | `90` | 危险阈值（已用 %，剩余 ≤ 100−该值 变红） |
| `balanceWarn` | number | `10` | 余额低于该值（CNY）标红 |
| `priceTable` | dict(any) | `{}` | 单价覆盖表；支持平铺 `{in,cr,cw,out}`（旧键 `pi/pcr/pcw/po`）或 `{peak,offPeak}` 两种形态 |
| `showCacheHitRate` | boolean | `true` | 面板是否显示「缓存命中率」行 |
| `showResetTime` | boolean | `false` | 在配置里下发；**客户端代码未读取该字段** |
| `entryVisibility` | object | 六项全 `true` | 各区块是否显示在侧边栏入口：`deepseek` / `glm` / `opencodeGo` / `qwen` / `volcesCoding` / `volcesAgent` |

浮动窗内可直接改的只有：火山 AK/SK（「key配置」）、套餐档位下拉、每个区块的「显示在入口」勾选。
`priceTable` / `pollIntervalSeconds` / 三个阈值 / `showCacheHitRate` 没有面板 UI，需直接改设置值。

## 主要能力

**宿主半**

- 轮询并缓存 5 个数据源：`state.deepseek` / `glm` / `opencode` / `volcesCoding` / `volcesAgent`。
  凭证经 `credentials.resolve()` 读取：`DEEPSEEK_API_KEY`、`BIGMODEL_API_KEY` 或 `ZAI_API_KEY`、
  `VISION_API_KEY`、`VOLCES_API_KEY`（仅用于标记已配置）。
- 会话用量：`subagents.listDescendants(rootId)` 收集 `kind === 'child'` 的子会话，
  总量取 `sessionProjections.snapshot(s).values.tokenUsage`，
  来源桶按 `assistant/message` 的 `source.provider` / `source.model` 归并，
  并用 `llm/retry-started` 做替换冲销（与 token-meter 投影同口径）。快照有 8 秒缓存。
- 同源 HTTP 路由（`webServer.register`）：

  | 方法 | 路径 | 说明 |
  |---|---|---|
  | GET | `/api-monitor/snapshot?root=<会话ID>` | 供应商状态 + 会话用量 + 生效配置；**未做同源校验** |
  | GET | `/api-monitor/config` | 生效配置摘要（含 `volcesKeyConfigured`） |
  | POST | `/api-monitor/refresh` | 强制刷新官方价格 + 立刻轮询全部；校验同源 |
  | POST | `/api-monitor/set-volces-keys` | 写入 AK/SK 并立即重查火山；校验同源 |
  | POST | `/api-monitor/set-tier` | 写入 `volcesTier`；校验同源 |
  | POST | `/api-monitor/set-visibility` | 写入 `entryVisibility`，只接受 6 个已知键；校验同源 |

- **未注册**任何 model 工具、命令或事件监听；对外只有上面的 HTTP 路由与设置命名空间。

**浏览器半**

- 向 `sidebar.footer.action` 注册一个 slot：`id: "api-monitor"`、`order: -20`、`label: "API 用量"`。
  窄侧边栏时退化为一个圆形图标按钮（`wide === false` 分支）。
- 每 **8000 ms** 拉一次 `/api-monitor/snapshot`（带当前会话 id），并在面板里做刷新/改配置后的重载。
- 注入一段组件作用域 CSS（`style[data-plugin-css="api-monitor/styles.css"]`），面板宽度固定 420px、
  最大高度 60vh；再点入口或点遮罩、按 Esc 关闭。

## 文件结构

```
api-monitor/
├── README.md            # 本文件
├── package.json         # name/version 0.2.6；dsh.bundle.patch 指向 cordis.patch.yml；dsh.client（web）
├── cordis.patch.yml     # bundle patch 层：一行 insert 挂载 id/name = api-monitor
└── lib/
    ├── index.js         # 宿主半：settings 命名空间 + 5 路轮询 + 会话树聚合 + /api-monitor/* 路由
    └── client.js        # 浏览器半（预构建产物，window.__ModuleLoader__.load 工厂）：侧边栏入口 + 浮动窗
```

## 备注 / 已知限制

- **声明依赖与实际 require 不一致**：`package.json` 的 `dsh.client.inject` 声明了
  `@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-runtime`、
  `@deepseek-ai/dsh-client-ui-primitives` 三项，但 `lib/client.js` 只 `require("react")`；
  它也没有注册 locale 字典，面板文案（「key配置」「读取套餐」「显示在入口」等）是硬编码中文。
- **面板底部时间文案与实现不符**：浮动窗固定显示「每 60s 自动刷新」，
  而客户端实际是 8000 ms 轮询、宿主定时器取决于 `pollIntervalSeconds`（下限 20 秒）。
- **`volcesTier` 是死配置**：可在面板下拉选择并持久化，但宿主从未把它用于请求或解析。
- **`showResetTime` 无人消费**：schema 与 `/config`、snapshot 都会带出，客户端不读。配额的重置时间
  在宿主 `parseQuotaRows` 里读成了 `reset`，但未进入对外快照。
- **`qwen` 区块没有对应的宿主轮询**：`entryVisibility.qwen` 只控制侧边栏是否显示，
  Qwen 数据来自会话桶（token / 调用次数），额度行在客户端写死为「接口不可查」并给一个外部控制台链接。
  因此 `state` 里只有 5 个供应商条目，而可见性键有 6 个。
- **`pollIntervalSeconds` 只在 apply 时生效**（`Math.max(20, ...)`），改小/改大都要重启插件；
  客户端快照轮询 8 秒也是写死的。
- **硬编码内容**：官方定价页 URL `https://api-docs.deepseek.com/zh-cn/quick_start/pricing`、
  内置价目表（注释标注按 2026-09-11 官方定价页校准，含峰谷两档）、
  OpenCode 请求使用的伪造 Chrome User-Agent、火山签名固定 `open.volcengineapi.com` 与 `cn-beijing` / `ark`。
- **依赖 DSH 内部 CSS 类名**：客户端 CSS 里有一条
  `.hHd-Xa_root:not(.hHd-Xa_collapsed) .hHd-Xa_footerActions{...}` —— 直接绑定侧边栏的哈希类名，
  壳层类名一变，竖排布局就会失效（功能不崩，只影响排版）。
- **会话来源归因需要 `source.provider`**：没有路由信息的事件只进总量、不进来源桶，
  所以「各来源相加 ≤ 总览总量」是预期行为。
- 宿主每轮轮询都用 `catch` 吞掉异常并写 `entry.error`（如「未配置」「HTTP 401」「接口错误」），
  面板只显示这一句短文案，日志里没有逐次堆栈（价格抓取失败会 `console.warn`）。
