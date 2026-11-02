# DSH 版本兼容

[返回首页](<../README.md>)

## 结论

**历史真实宿主验证（1.1.0 完成，非完整浏览器 E2E）：DSH `0.2.2-alpha.2`，Windows Web profile。** 1.1.1 的安装清单范围覆盖 DSH `0.2.1-rc.5`（见下表验证等级）；1.1.1 自身尚未在任何宿主完成端到端验证。

上述历史验证范围（1.1.0 记录）包含安装启用、Host 配置读写、Client 注册、真实子代理请求的模型/强度记录，以及团队消息参数守卫；它**不是完整浏览器端到端验收**（无逐像素、完整表单点击或主题视觉验证），也未在 1.1.1 上重做。77 项自动化测试（0 跳过）覆盖业务逻辑、Client 依赖声明和守卫；自动化同样不等于浏览器 E2E。具体见 [TESTING.md](<../TESTING.md>)。

| 条件 | 当前状态 |
| --- | --- |
| DSH `0.2.2-alpha.2` + Windows Web | 历史真实宿主验证（1.1.0，非完整浏览器 E2E）：以上范围 |
| DSH `0.2.1-rc.5` | 清单接纳（1.1.1 起）；静态比对 + **组件级路由验证通过（22/22 PASS）**：回退路径下首轮/次轮请求配置覆盖正确；**真实 LLM / 完整 agent-loop / 浏览器与网络 E2E 未做** |
| 低于 `0.2.1-rc.5` | 不支持，清单不接纳 |
| 其他 `0.2.x` | 未逐版验证，须通过 DSH 自己的版本匹配检查 |
| DSH `0.3.0` 及以上（含其预发布版） | 不在当前声明范围，需适配 |
| macOS / Linux | 未进行 DSH 端到端测试，不宣称已验证 |
| Desktop | 未验证；不能只根据其内置 DSH 版本相近就视为支持 |
| 纯 headless / TUI | 不提供设置面板，不是支持目标 |
| Codex CLI / Claude Code CLI / ACP 子进程 | 本插件不管理这些外部进程的模型 |

## 声明范围和实测范围不同

[package.json](<../package.json>)：

```json
{
  "engines": {
    "node": ">=22",
    "dsh": "^0.2.1-rc.5"
  }
}
```

这是**安装器兼容性门槛**，不是“每个版本都测试过”的保证。当前 DSH 使用 SemVer 并开启 `includePrerelease: true`；`^0.2.1-rc.5` 的上限是 `<0.3.0-0`，因此允许起始版本及后续 `0.2.x`，但明确排除 `0.3.0-alpha.*` 和正式 `0.3.0`。不能使用普通 `<0.3.0` 冒充这个上限，因为后者会接受部分 `0.3.0` 预发布版本。

1.1.0 写的是 `^0.2.2-alpha.2`，其下限高于 `0.2.1-rc.5`：在 DSH `0.2.1-rc.5` 上安装会被 `unmet requirements: engines.dsh` 拒绝（实测 `semver.satisfies("0.2.1-rc.5", "^0.2.2-alpha.2", { includePrerelease: true })` 为 `false`）。1.1.1 起下限放宽到 `0.2.1-rc.5`，上限语义不变。

用 DSH 自带的 semver、与安装器完全相同的选项（`includePrerelease: true`）实测 `^0.2.1-rc.5`：

| 宿主版本 | 判定 |
| --- | --- |
| `0.2.1-rc.4` | 拒绝 |
| `0.2.1-rc.5` | 接纳 |
| `0.2.1` | 接纳 |
| `0.2.2-alpha.2` | 接纳 |
| `0.2.2` | 接纳 |
| `0.3.0-alpha.1` | 拒绝 |
| `0.3.0` | 拒绝 |

判定来自 DSH 的 `includePrerelease: true` 选项：预发布版本参与匹配，所以 `0.2.2-alpha.2` 这类预发布**在范围内**。不要用普通 SemVer 的默认规则（预发布默认不匹配 range）去推断 DSH 安装器的判定，两者结论不同。上限严格是 `<0.3.0-0`，`0.3.0` 的预发布与正式版都被拒绝。

安装器拒绝时不要直接申请风险豁免；应先核对宿主接口或等待适配。

插件的 Node 声明也不替代 DSH 自身的 Node 要求。手工使用 [会话验证脚本](<../test/verify-session.mjs>)还需要支持 `node:zlib` Zstandard API 的 Node 版本；该脚本不是插件运行依赖，不会随插件加载自动读取会话。

## 所需 DSH 能力

本插件复用原生服务，不重新实现协议：

- Host：`llm`、`settings`、`sessionController`、`tools`、`credentials`。
- 生命周期：可等待的 `agent/created` 和官方 `model/selection` 事件；模型选择优先 `agent.model.select()`，宿主缺少它时（如 `0.2.1-rc.5`）回退 `sessionController.agents.selectForNextRequest`（内部接口，见下节）。
- Client：`slots`、`locale`、`remote` 以及 `remote.settings`、`remote.session`、`remote.llm`、`remote.credentials`。
- UI 插槽：`settings.section` 和 `plugins.bundle.config`。
- 自定义 API：原生 `@deepseek-ai/dsh-llm-pi-ai` 的可编辑 providers 目录。

自定义精简 profile 若缺少这些能力，插件可能无法激活或无法显示；不要仅凭安装成功就判定可用。

## 0.2.1-rc.5 的比对与组件级验证

以下是与 `0.2.2-alpha.2` 的逐项比对和组件级验证结果，**不是端到端运行验证**：

- 清单契约一致：`dsh.bundle.patch` 与 `cordis.patch.yml` 的 patch 类型、`dsh.client` 的 `platform` / `immediately` / `inject` 字段定义两版相同。
- 客户端模块清单仅少 `asset()` / `resolveAsset()` 资产解析；本插件产物为纯内联（逻辑、样式、双语文案全部打进 `client.js`），不使用资产引用。
- 一致的部分：`tools/pre-execute`、`tools/execute`、`settings.section`、`plugins.bundle.config` 等插件用到的接口在 `0.2.1-rc.5` 对应包中存在。
- **不一致的部分（关键）**：`0.2.1-rc.5` **没有 `agent.model`**，`agent.model.select()` 不存在，旧实现在 rc.5 上固定模型必然抛错。1.1.1 的适配顺序：优先 `agent.model.select()` → feature-detect 回退 `sessionController.agents.selectForNextRequest`（**内部/private 接口**，后续版本可能变更或移除，回退路径可用性随宿主浮动）→ 两者都不可用时**子代理创建失败**并说明原因，不静默用错模型。**任何路径都不会调用公共 `selectModel`**：它修改部署默认模型且拒绝子代理请求，会越过本插件“只影响新建本地子代理”的隔离边界。
- 插件依赖的 `@deepseek-ai/schemastery ~3.18.6-alpha.1` 与 rc.5 宿主自带的 `~3.18.5` 是独立副本，沿用 1.0.x 以来的模式；未出现真实不兼容实证前保持不变。
- **组件级路由验证（22/22 PASS）**：真实 Cordis 4.0.5 + rc.5 组件执行 `ApiSessionAgentController` / `selectForNextRequest` / `installModelSelection` / `resolveChildAgentOptions`；最终 system-prompt/assemble variables 与 agent/request config 首轮/次轮（provider/model/effort）覆盖正确，maxTokens 保留。**这不是**真实 LLM、完整 agent-loop 或浏览器/网络 E2E：探针 loop seed 为复刻、session 为内存桩。可选复核脚本 [`test/verify-rc5-runtime.mjs`](<../test/verify-rc5-runtime.mjs>)（portable，调用插件实际 `applyChildSelection`）。
- **条件风险（自定义 preset / 路由插件场景未保证）**：若其他插件在本插件之前自装独立的 `installModelSelection` ref，先注册者可能覆盖路由选择；rc.5 标准 `spawn` / `fork` 只带 `AgentOptions`，没有该冲突。与自定义 preset 或第三方路由插件混用时请自行核对实际请求模型。

在 `0.2.1-rc.5` 上首次启用时，请按下方清单完整走一遍，**重点核对新建本地子代理的真实请求模型**：回退路径走的是内部接口，必须以真实请求证据确认生效，不能把“创建成功”当作“模型正确”。

## 升级 DSH 后的检查清单

1. 备份自己的必要设置；备份不要上传到 GitHub。
2. 查看 `dsh --version` 和插件管理器兼容提示。
3. 确认“设置 → 子代理模型”可打开，已有分组/模型/强度可读取。
4. 保存一个合法选择，检查冲突和错误提示。
5. 新建本地子代理进行最小任务，核对实际请求模型/强度。
6. 确认主代理、既有子代理不受影响，测试完成恢复原设置。
7. 自定义 API 的联网验证需使用自己的可信服务商；不要把配置落盘成功当作推理成功。

如果宿主接口发生变化，请附版本和脱敏复现步骤提交 [Issue](<https://github.com/junjundesk/dsh-subagent-model/issues>)。
