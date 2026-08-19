# api-monitor

> DSH（DeepSeek Harness）插件：**常驻 API 用量监控**。
> 侧边栏底部常驻摘要 + 独立浮动窗，实时查看 DeepSeek / SiliconFlow 余额、OpenCode Go 与火山引擎（Coding Plan / Agent Plan）订阅配额，以及当前会话树（主会话 + 全部子代理）的 token 用量与花费。

## 功能

- **余额与配额监控**：
  - DeepSeek — `GET api.deepseek.com/user/balance`
  - SiliconFlow — `GET api.siliconflow.cn/v1/user/info`
  - OpenCode Go — `GET opencode.ai/zen/go/v1/usage`
  - 火山引擎 — `GetCodingPlanUsage` / `GetAFPUsage`（SigV4 签名）
- **会话树用量**：统计主会话与全部子代理的 token 用量与花费（价格表可配置）
- **入口**：侧边栏底部 `.footArea`。宽侧栏显示整行紧凑摘要（⛽ DS 余额 · SF 余额 · OC 剩余%），位于 Cordis 面板按钮上方；侧栏收起（rail）时退化为圆形图标；点击弹出独立浮动窗（标题栏 + ✕ 关闭 + Esc 关闭）
- **轮询**：默认 60s 可配置；余额低于阈值（warn/danger）变色提示
- **凭据**：经 `ctx.credentials.resolve()` 读取 `DEEPSEEK_API_KEY` / `SILICONFLOW_API_KEY` / `VISION_API_KEY` / `VOLCES_API_KEY`

## 安装

在目标电脑的 DSH 环境执行：

```bash
dsh plugin --profile web add "github:jcleener/api-monitor"
```

或固定版本：

```bash
dsh plugin --profile web add "github:jcleener/api-monitor#v0.1.0"
```

安装后重启 `dsh web`，侧边栏底部即出现监控入口。

> 早期「手动粘贴到 Cordis 面板」的源码与恢复步骤保留在 [`legacy/`](./legacy/)，已不推荐使用。

## 配置

设置命名空间 `api-monitor`（在 DSH 设置页或 `~/.dsh/settings.yaml` 中配置）：

| 键 | 默认 | 说明 |
|---|---|---|
| `volcesAccessKeyId` / `volcesSecretAccessKey` | 空 | 火山引擎 AK/SK（配额查询专用，`role('secret')` 脱敏） |
| `volcesTier` | `auto` | 火山档位 |
| `pollIntervalSeconds` | `60` | 轮询间隔（秒） |
| `warnPercent` / `dangerPercent` | `70` / `90` | 配额剩余比例预警 / 告警阈值 |
| `balanceWarn` | `10` | 余额预警阈值（元） |
| `priceTable` | `{}` | 模型价格表（token 计费） |
| `showCacheHitRate` / `showResetTime` | `true` / `false` | 是否显示缓存命中率 / 重置时间 |
| `entryVisibility.*` | `true` | 各供应商入口是否显示 |

## 工作原理

- Host 半段（`lib/index.js`）常驻 dsh web 进程：注册 `api-monitor` 配置命名空间，轮询各供应商接口，聚合会话树 token 用量，经同源 `/api-monitor/*` HTTP 路由提供给浏览器。
- Client 半段（`lib/client.js`）以 `sidebar.footer.action` 槽渲染入口与浮动窗。
- 兼容性处理：沙箱无 crypto 时使用内嵌纯 JS SHA-256/HMAC；无 raw HTTP 服务时经 `ctx.shell`（curl）发 HTTP。

## 开发 / 结构

```
lib/index.js      Host 半段（纯 JS）
lib/client.js     Client 半段（React.createElement）
cordis.patch.yml  加载器补丁层（insert 声明）
PRD.md            产品需求文档
legacy/           早期手动粘贴版源码
```

## 更新日志

### v0.1.1

- **stale-while-revalidate**：OpenCode Go（以及 DeepSeek / SiliconFlow / 火山 Coding / 火山 Agent）数据拉取中或失败时，不再显示占位符（`—`），而是保留并显示**上次成功读取的数据**，弱化显示并标注「↑ 显示上次数据（HH:MM 获取）」；恢复成功后自动切回实时数据。

### v0.1.0

- 首个公开版本：常驻 API 用量监控（DeepSeek / SiliconFlow / OpenCode Go / 火山引擎 余额与配额、会话树 token 与花费，侧边栏入口 + 独立浮动窗）。

## 许可证

MIT © 2025 [jcleener](https://github.com/jcleener)
