# 更新记录

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
