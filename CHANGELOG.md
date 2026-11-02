# 更新记录

## 1.1.1

面向 DSH `0.2.1-rc.5` 的兼容版本：安装门槛放宽，并新增子代理模型选择的适配路径。

### 修复：在 DSH 0.2.1-rc.5 上无法安装

- 1.1.0 的 `engines.dsh: ^0.2.2-alpha.2` 下限高于 `0.2.1-rc.5`，在 rc.5 宿主上被安装器以 `engines.dsh` 未满足拒绝（两版 DSH 判定均为 `semver.satisfies(..., { includePrerelease: true })`，实测 `0.2.1-rc.5` 不满足 `^0.2.2-alpha.2`）。
- 改为 `engines.dsh: ^0.2.1-rc.5`（即 `>=0.2.1-rc.5 <0.3.0-0`）。用 DSH 自带 semver、安装器同款 `includePrerelease: true` 实测：`0.2.1-rc.5` / `0.2.1` / `0.2.2-alpha.2` / `0.2.2` **接纳**，`0.2.1-rc.4`、`0.3.0-alpha.1`、`0.3.0` **拒绝**。上限严格为 `<0.3.0-0`；预发布版本参与匹配（`0.2.2-alpha.2` 在范围内），不要按普通 SemVer 默认规则推断 DSH 的判定。

### 修复：在 0.2.1-rc.5 上固定子代理模型必然失败

rc.5 **没有 `agent.model`**（不存在 `agent.model.select()`），旧实现在 rc.5 上选模型必然抛错。本次为模型选择增加适配路径（`applyChildSelection` 增加第四参数 `sessionController`）：

- 优先使用 modern 接口 `agent.model.select()`（如 `0.2.2-alpha.2`）；
- 缺少时 **feature-detect 回退** `sessionController.agents.selectForNextRequest`。这是 DSH **内部/private 接口**（非公共契约，后续版本可能变更或移除）；
- **绝不调用公共 `selectModel`**：它修改部署默认模型并拒绝子代理请求，越过本插件“只影响新建本地子代理”的边界，本插件任何路径都不会调用它；
- 路由校验失败时**子代理创建直接失败**并给出原因，不静默回退到错误模型。

### 发布一致性

- 客户端自报版本同步为 `1.1.1`，并在源模板与构建产物的契约测试中检查其与包版本一致，避免升级后的诊断信息仍显示旧版本。

### 不变的部分

- 不改变主代理模型、既有子代理、原生模型分组与密钥。
- `@deepseek-ai/schemastery` 保持 `~3.18.6-alpha.1`：与宿主自带 `~3.18.5` 是独立副本（1.0.x 起即为此模式），未出现真实不兼容实证前不改动。
- `build.mjs` 与 `cordis.patch.yml` 无改动：构建产物纯内联、`cordis.patch.yml` 的 patch 契约两版一致。

### 验证分级

| 级别 | 范围 |
| --- | --- |
| 历史真实宿主验证（1.1.0，非完整浏览器 E2E） | DSH `0.2.2-alpha.2` / Windows Web profile（记录见 [TESTING.md](TESTING.md)） |
| 静态比对 + 安装清单判定 | DSH `0.2.1-rc.5`：清单契约、`dsh.client` 声明、UI 插槽、`tools` 钩子一致；确认 rc.5 无 `agent.model`，须走上述回退路径 |
| 组件级路由验证已完成（22/22 PASS） | 真实 Cordis 4.0.5 + rc.5 组件执行 `ApiSessionAgentController` / `selectForNextRequest` / `installModelSelection` / `resolveChildAgentOptions`；system-prompt/assemble variables 与 agent/request config 首轮/次轮（provider/model/effort）覆盖正确，maxTokens 保留 |
| 仍未做 | 真实 LLM、完整 agent-loop、浏览器/网络 E2E（组件探针 loop seed 为复刻、session 为内存桩） |
| 自动化测试 | 77 项全通过（0 跳过，干净 `npm ci` + `build` + `check` + `test`） |

### 升级与安装注意

- 配置结构保持不变；升级前备份并在升级后核对原有选择。在 rc.5 上首次启用后，请按 [兼容性说明](docs/COMPATIBILITY.md) 的检查清单确认固定模型真实生效。
- 通过固定标签 `github:junjundesk/dsh-subagent-model#v1.1.1` 安装，或从 [v1.1.1 Release](<https://github.com/junjundesk/dsh-subagent-model/releases/tag/v1.1.1>) 下载已编译的插件包及 SHA-256 校验文件；安装后重启目标 profile 并刷新浏览器。

## 1.1.0

### 团队消息参数守卫

- 针对 `active teammate "<uuid>" not found`：识别把子代理/会话 UUID 当成队友名的 `send_message` / `interrupt_agent` 调用，返回应使用的队友名字或合法名字列表，而不是原始堆栈。
- 合法调用（`lead`、有效队友名、子代理控制工具的 `agent_id`）不受影响。
- 挂载 Agent Teams 时注册一条很短的提示，引导先 `list_agents` 再用 `target`。
- 明确限制：DSH 的 `tools/pre-execute` / `tools/execute` 不允许插件改写参数；本功能是“校验 + 可纠正拒绝”，不是篡改工具调用。
- 新增 `guardTeamTargets` 配置（默认 `true`），可在 profile 配置中关闭。
- 自动化测试增至 44 项，全部通过。

### 注意

- 这是独立的防御功能，不改变子代理模型选择、主代理模型或原生 Agent Teams 工具定义。
- 升级后需重启 DSH profile 才会加载新的 Host 代码，并刷新浏览器。

## 1.0.1

### 修复设置页无法读取数据

- 为 Client 补齐 `remote.settings`、`remote.session`、`remote.llm`、`remote.credentials` 的独立依赖声明。
- 修复进入“设置 → 子代理模型”时出现 `cannot get property "remote.settings" without inject`。
- 增加源文件与生成产物的依赖契约测试，当前 41 项测试通过。

### GitHub 分发与使用说明

- 提供固定版本标签安装、DSH CLI 安装命令和可下载的安装包。
- 补齐已有模型、自定义 API、推理强度、安全边界与故障排查教程。
- 明确已验证宿主为 DSH **0.2.2-alpha.2 / Windows Web profile**，不把清单声明范围当作实测兼容范围。
- 发布时把 DSH 声明范围收紧为 `^0.2.2-alpha.2`，排除尚未适配的 `0.3.0` 预发布版本。

### 升级注意

- 不改变主代理默认模型，不主动改动原生模型分组或密钥。
- 从旧包升级前记下固定模型设置；若安装器不支持覆盖，按提示卸载后安装新版本，并检查是否需要重选。
- 安装后关闭设置面板重新打开；仍有旧缓存时强制刷新，必要时按安装器提示重启 profile。
- 自定义 API 的密钥/分组是分步保存，部分成功需按提示检查，不能盲目重试。

## 1.0.0

- 初始实现：为新建本地子代理选择 DSH 现有分组、模型和推理强度。
- 支持 Chat、Responses、Claude 三类自定义 API，复用 DSH 原生适配器及凭据服务。
- 提供中英文设置页、原创图标和共享操作 Agent 工具。
- 已知问题：Client Remote 依赖声明不完整；请使用 **1.0.1 或更新版本**，不要安装 1.0.0。
