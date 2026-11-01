# DSH 版本兼容

[返回首页](<../README.md>)

## 结论

**插件 1.0.1 目前已验证的宿主版本是 DSH `0.2.2-alpha.2`，环境为 Windows 上的 Web profile。**

已验证范围包含安装启用、Host 配置读写、Client 注册和真实子代理请求的模型/强度记录。41 项自动化测试覆盖业务逻辑和 Client 依赖声明；它们不等于完整浏览器端到端测试。具体见 [TESTING.md](<../TESTING.md>)。

| 条件 | 当前状态 |
| --- | --- |
| DSH `0.2.2-alpha.2` + Windows Web | 已验证以上范围 |
| 低于 `0.2.2-alpha.2` | 不支持，清单不接纳 |
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
    "dsh": "^0.2.2-alpha.2"
  }
}
```

这是**安装器兼容性门槛**，不是“每个版本都测试过”的保证。当前 DSH 使用 SemVer 并开启 `includePrerelease: true`；`^0.2.2-alpha.2` 的上限是 `<0.3.0-0`，因此允许起始版本及后续 `0.2.x`，但明确排除 `0.3.0-alpha.*` 和正式 `0.3.0`。不能使用普通 `<0.3.0` 冒充这个上限，因为后者会接受部分 `0.3.0` 预发布版本。

安装器拒绝时不要直接申请风险豁免；应先核对宿主接口或等待适配。

插件的 Node 声明也不替代 DSH 自身的 Node 要求。手工使用 [会话验证脚本](<../test/verify-session.mjs>)还需要支持 `node:zlib` Zstandard API 的 Node 版本；该脚本不是插件运行依赖，不会随插件加载自动读取会话。

## 所需 DSH 能力

本插件复用原生服务，不重新实现协议：

- Host：`llm`、`settings`、`sessionController`、`tools`、`credentials`。
- 生命周期：可等待的 `agent/created`，以及 `agent.model.select()` 和官方 `model/selection` 事件。
- Client：`slots`、`locale`、`remote` 以及 `remote.settings`、`remote.session`、`remote.llm`、`remote.credentials`。
- UI 插槽：`settings.section` 和 `plugins.bundle.config`。
- 自定义 API：原生 `@deepseek-ai/dsh-llm-pi-ai` 的可编辑 providers 目录。

自定义精简 profile 若缺少这些能力，插件可能无法激活或无法显示；不要仅凭安装成功就判定可用。

## 升级 DSH 后的检查清单

1. 备份自己的必要设置；备份不要上传到 GitHub。
2. 查看 `dsh --version` 和插件管理器兼容提示。
3. 确认“设置 → 子代理模型”可打开，已有分组/模型/强度可读取。
4. 保存一个合法选择，检查冲突和错误提示。
5. 新建本地子代理进行最小任务，核对实际请求模型/强度。
6. 确认主代理、既有子代理不受影响，测试完成恢复原设置。
7. 自定义 API 的联网验证需使用自己的可信服务商；不要把配置落盘成功当作推理成功。

如果宿主接口发生变化，请附版本和脱敏复现步骤提交 [Issue](<https://github.com/junjundesk/dsh-subagent-model/issues>)。
