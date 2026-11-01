# 验证记录

本文件记录已验证的范围和已知限制，不包含真实用户的模型分组、会话 ID、日志路径或凭据。

## 当前版本

- 插件：`dsh-subagent-model@1.0.1`。
- 已验证 DSH：`0.2.2-alpha.2`。
- 实际宿主环境：Windows、Web profile。
- 自动化：**41 项测试通过**；源码和生成产物的 JavaScript 语法检查通过。

## 已验证

### 业务逻辑和安全边界

- 原有分组/模型/强度目录读取。
- 固定模型和继承模式的 revision 写入、过期冲突与只读拒绝。
- 新建子代理模型选择与主代理、既有/恢复子代理的隔离。
- Chat、Responses、Claude 的原生适配器配置映射。
- 地址、token 限制、推理强度、凭据引用的输入校验。
- 已有分组不覆盖、重复路由拒绝、密钥不进入配置结果。
- 分组已提交但后置校验失败时的部分成功返回，避免盲目重复写入。

### DSH 真实环境

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

## 未验证、不能据此承诺的部分

- 没有浏览器自动控制或截图验收：不声称做过逐像素、完整表单点击或深浅主题人工视觉验证。
- 未使用新服务商的真实密钥做联网推理测试：具体网关的认证、额度、工具调用和推理参数兼容性仍取决于服务商。
- 未逐个测试所有 DSH `0.2.x` 版本，也未进行 macOS、Linux、Desktop 的 DSH 端到端测试。
- 静态 Client 契约测试、目录校验、配置落盘成功，都不能代替实际请求验证。

## 重跑自动化检查

```bash
npm ci --ignore-scripts
npm run build
npm run check
npm test
```

[业务测试](<test/logic.test.mjs>)覆盖路由和配置操作；[Client 契约测试](<test/client-contract.test.mjs>)检查源文件与生成产物的 Remote 依赖声明。

## 可选：核对自己的测试会话

[verify-session.mjs](<test/verify-session.mjs>)接收明确指定的自有 `.jsonl.zstd` 测试会话文件，要求运行时具备 Node Zstandard API：

```bash
node test/verify-session.mjs "/absolute/path/to/your/test-session.v4.jsonl.zstd"
```

该脚本只输出会话 ID 和路由字段，并断言后续请求匹配模型选择，不输出对话、工具内容或凭据。仅适配验证时的 DSH V4 存储形状，不是产品运行依赖，也不会随插件启动自动运行。请勿将真实会话文件或脚本输出提交到公共仓库。
