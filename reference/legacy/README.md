# legacy/ — 早期手动粘贴版

这些是 api-monitor 早期开发形态的源码：通过 Cordis 面板**手动粘贴**安装的动态插件
（DSH 重启即消失，需要每次手动恢复）。现在推荐使用本仓库的 bundle 版本（`lib/` + `cordis.patch.yml`），
通过 `dsh plugin add` 安装。

| 文件 | 说明 |
|---|---|
| `host.js` | 早期 Host 半段（粘贴到 Cordis 面板 code.host） |
| `client.js` | 早期 Client 半段（粘贴到 Cordis 面板 code.client） |

## 早期一键恢复步骤（仅作参考）

1. 打开 Cordis 面板，新建插件（语义前缀 `apimon`），把 `host.js` 粘贴到 code.host、`client.js` 粘贴到 code.client。
2. `cordis_define` → 记下返回的 `pluginId` 与 `packageId`。
3. `cordis_run`（模式 `run`）激活该 Package。
4. 在 GUI 中批准 Client 半段授权，侧边栏即出现入口。

> 动态插件存于进程内存，DSH 重启即消失；配置/凭据天然持久于 `~/.dsh/settings.yaml` / `.credentials.yaml`。
