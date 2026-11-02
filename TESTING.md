# 验证记录

本文件记录已验证的范围和已知限制，不包含真实用户的模型分组、会话 ID、日志路径或凭据。

## 当前版本

- 插件：`dsh-subagent-model@1.1.1`。
- 历史真实宿主验证（1.1.0，**非完整浏览器 E2E**）：DSH `0.2.2-alpha.2`，Windows、Web profile。
- `0.2.1-rc.5`：静态比对 + 模型选择适配 + **组件级路由验证（22/22 PASS）** 已完成；**真实 LLM / 完整 agent-loop / 浏览器与网络 E2E 未做**（分级见 1.1.1 小节）。
- 自动化：**77 项测试全通过（0 跳过）**，经干净 `npm ci` + `build` + `check` + `test` 验证；源码和生成产物的 JavaScript 语法检查通过。

## 已验证

### 业务逻辑和安全边界

- 原有分组/模型/强度目录读取。
- 固定模型和继承模式的 revision 写入、过期冲突与只读拒绝。
- 新建子代理模型选择与主代理、既有/恢复子代理的隔离。
- Chat、Responses、Claude 的原生适配器配置映射。
- 地址、token 限制、推理强度、凭据引用的输入校验。
- 已有分组不覆盖、重复路由拒绝、密钥不进入配置结果。
- 分组已提交但后置校验失败时的部分成功返回，避免盲目重复写入。

### DSH 真实环境（1.1.0 历史记录）

- 通过官方插件管理器安装启用，返回 `application: applied`。
- Host Config 已激活。
- 当前连接页面注册了 `settings.section` 与 `plugins.bundle.config`。
- 插件工具实际读写设置、读取模型目录成功。
- 临时选择已有合法路由，启动新本地子代理，收到预期响应。
- 对测试会话做只读核验：官方 `model/selection` 与后续 `request/header` 的 provider/model/reasoningEffort 一致，确认请求真正采用选定值。
- 测试后恢复原有模型设置，没有保存测试自定义分组或密钥。

### 1.0.1 回归修复

1.0.0 用户反馈设置页出现：

```text
cannot get property "remote.settings" without inject
```

原因是仅声明了 `remote` 根服务，遗漏细粒度 Remote 命名空间依赖。**Slot 注册成功不等于页面已经读取数据成功**。

1.0.1 增加 `remote.settings`、`remote.session`、`remote.llm`、`remote.credentials`。新增两项契约测试在旧代码上失败、修复后通过；新版安装后，连接页面的注册标识变为 `dsh-subagent-model@1.0.1`。

### 1.1.0 团队消息参数守卫

- 新增 `teamTargetIssue`：将队友会话 UUID 解析为对应名字，未知名字/UUID/`provisioning`/`failed` 返回可纠正提示；`lead`、有效队友名和子代理控制工具的 `agent_id` 调用不受影响。
- 新增守卫注册测试：确认只拦截 Team 的 `send_message` / `interrupt_agent`，不拦截插件自己的工具或没有 caller agent 的调用。
- 挂载 Agent Teams 时注册一条短提示；无 Teams 的 profile 不增加提示。
- 明确限制：DSH 不允许插件改写参数，守卫只能拒绝并说明正确参数，不能替模型替换调用。
- 自动化测试从 41 项增至 **44 项**，全部通过。

### 1.1.1 DSH 0.2.1-rc.5 兼容

- **安装门槛**：`engines.dsh` 改为 `^0.2.1-rc.5`（`>=0.2.1-rc.5 <0.3.0-0`）。用 DSH 自带 semver + `includePrerelease: true`（安装器同款判定）实测：`0.2.1-rc.5` / `0.2.1` / `0.2.2-alpha.2` / `0.2.2` 通过，`0.2.1-rc.4` / `0.3.0-alpha.1` / `0.3.0` 拒绝；完整矩阵见 [版本兼容](<docs/COMPATIBILITY.md>)。判定依据是 DSH 的 `includePrerelease: true` 选项，不是普通 SemVer 默认规则。
- **模型选择适配**：`applyChildSelection` 增加 `sessionController` 参数。选择顺序：优先 `agent.model.select()` → feature-detect 回退 `sessionController.agents.selectForNextRequest`（**内部/private 接口**，后续版本可能变更或移除）→ 两者都不可用时**创建失败**并说明原因，不静默用错模型。**任何路径都不调用公共 `selectModel`**（它改部署默认模型且拒绝子代理）。
- **静态比对**：`dsh.bundle.patch` 与 `cordis.patch.yml` 契约、`dsh.client` 声明两版一致；`tools/pre-execute`、`tools/execute`、`settings.section`、`plugins.bundle.config` 存在；确认 `0.2.1-rc.5` **没有 `agent.model`**（固定模型在旧实现下必崩，是本次适配的直接原因）。
- **组件级路由验证（22/22 PASS）**：真实 Cordis 4.0.5 + rc.5 组件执行 `ApiSessionAgentController` / `selectForNextRequest` / `installModelSelection` / `resolveChildAgentOptions`；最终 system-prompt/assemble variables 与 agent/request config 首轮/次轮（provider/model/effort）覆盖正确，maxTokens 保留。边界：**非真实 LLM、非完整 agent-loop、非浏览器/网络 E2E**；loop seed 为复刻、session 为内存桩。可选 portable 脚本 [`test/verify-rc5-runtime.mjs`](<test/verify-rc5-runtime.mjs>) 调用插件实际 `applyChildSelection`，不提前安装选择监听器，验证兼容桥首次调用时能自行安装；缺省强度场景先断言种子含 `high`，再断言最终请求移除该字段。22/22 项断言通过，且公共 `selectModel` 与部署默认模型均未被访问。
- **验证分级**：

| 级别 | 内容 |
| --- | --- |
| 历史真实宿主验证（1.1.0，非完整浏览器 E2E） | DSH `0.2.2-alpha.2` / Windows Web profile |
| 静态比对 + 判定验证 | DSH `0.2.1-rc.5`：清单契约、Client 声明、UI 插槽、`tools` 钩子、SemVer 安装判定 |
| 组件级路由验证（22/22 PASS） | 真实 Cordis 4.0.5 + rc.5 组件下 `selectForNextRequest` 回退路径：assemble/请求配置首轮/次轮 provider/model/effort 覆盖正确、maxTokens 保留 |
| 仍未做 | 真实 LLM、完整 agent-loop、浏览器/网络 E2E（loop seed 为复刻、session 为内存桩） |
| 自动化测试 | 77 项全通过（0 跳过） |

## 未验证、不能据此承诺的部分

- 没有浏览器自动控制或截图验收：不声称做过逐像素、完整表单点击或深浅主题人工视觉验证。
- 未使用新服务商的真实密钥做联网推理测试：具体网关的认证、额度、工具调用和推理参数兼容性仍取决于服务商。
- 未逐个测试所有 DSH `0.2.x` 版本，也未进行 macOS、Linux、Desktop 的 DSH 端到端测试。
- **DSH `0.2.1-rc.5` 未做完整端到端**：内部接口回退路径已有组件级路由验证（22/22 PASS，见 1.1.1 小节），但未接真实 LLM、未跑完整 agent-loop、未做浏览器/网络 E2E，不能当作端到端承诺。
- 静态 Client 契约测试、目录校验、配置落盘成功，都不能代替实际请求验证。

## 重跑自动化检查

```bash
npm ci --ignore-scripts
npm run build
npm run check
npm test
```

[业务测试](<test/logic.test.mjs>)覆盖路由和配置操作；[Client 契约测试](<test/client-contract.test.mjs>)检查源文件与生成产物的 Remote 依赖声明。

## 可选：重跑真实 rc.5 组件级验收

[verify-rc5-runtime.mjs](<test/verify-rc5-runtime.mjs>) 不属于默认的 77 项测试，不会自动安装依赖或启动服务。在独立的新建 npm 工程目录中安装精确版本（不要在运行中的 DSH profile 或插件源码目录安装这些宿主依赖）：

```bash
npm init -y
npm install --ignore-scripts --no-audit --no-fund @deepseek-ai/cordis@4.0.5 @deepseek-ai/dsh-agent@0.2.1-rc.5 @deepseek-ai/dsh-api-session-controller@0.2.1-rc.5 @deepseek-ai/dsh-subagent@0.2.1-rc.5
```

然后从插件源码目录运行，传入刚才隔离工程的绝对路径：

```bash
node test/verify-rc5-runtime.mjs "/absolute/path/to/rc5-probe"
```

预期输出 `{"total":22,"pass":22,"fail":0}`。探针先核对实际加载的包名/版本，再用真实 rc.5 控制器与 Cordis 瀑布执行插件选择逻辑，不连接服务商、不使用凭据、不读取用户会话。内存会话与 loop 种子是测试夹具，因此不能将这 22 项断言称为完整 Agent-loop 或联网端到端测试。

npm 发布包不含源码锁文件；单独解包运行测试时，[包元数据测试](<test/package-metadata.test.mjs>) 的锁文件一致性项会按设计跳过，其他检查照常执行。

## 可选：核对自己的测试会话

[verify-session.mjs](<test/verify-session.mjs>)接收明确指定的自有 `.jsonl.zstd` 测试会话文件，要求运行时具备 Node Zstandard API：

```bash
node test/verify-session.mjs "/absolute/path/to/your/test-session.v4.jsonl.zstd"
```

该脚本只输出会话 ID 和路由字段，并断言后续请求匹配模型选择，不输出对话、工具内容或凭据。仅适配验证时的 DSH V4 存储形状，不是产品运行依赖，也不会随插件启动自动运行。请勿将真实会话文件或脚本输出提交到公共仓库。
