QQ交流群:744475787

# 子代理模型 · dsh-subagent-model

为 **DeepSeek Harness（DSH）新建的本地子代理**单独选择分组、模型和推理强度，主对话模型保持不变。支持自定义 **Chat Completions、Responses、Claude / Anthropic Messages API**。

- 当前插件版本：**1.1.1**，支持 DSH `0.2.1-rc.5`（安装门槛放宽 + 子代理模型选择适配）；1.1.0 包含团队消息参数守卫，1.0.1 修复了设置页 `remote.settings without inject` 问题。
- 历史真实宿主验证（1.1.0，**非完整浏览器 E2E**）：**0.2.2-alpha.2 / Web profile / Windows**；`0.2.1-rc.5` 为静态比对 + 适配 + **组件级路由验证（22/22 PASS）**，真实 LLM / 完整 agent-loop / 浏览器与网络 E2E 未做（验证分级见 [验证范围](<TESTING.md>)）。
- 原生 DSH 插件；不是独立网页，不需要另开服务。
- 默认不覆盖任何模型，安装后由你决定是否启用固定模型。

[使用教程](<docs/USAGE.md>) · [版本兼容](<docs/COMPATIBILITY.md>) · [更新记录](<CHANGELOG.md>) · [验证范围](<TESTING.md>) · [发布下载](<https://github.com/junjundesk/dsh-subagent-model/releases>)

## 功能

| 功能 | 说明 |
| --- | --- |
| 现有模型选择 | 直接读取 DSH 已有分组 → 模型 → 推理强度，不硬编码厂商列表 |
| 固定子代理模型 | 新建本地子代理使用指定模型；不改变主代理或已存在的子代理 |
| 自定义 API | 填写地址、密钥、精确模型 ID、上下文窗口和输出上限 |
| 三种请求接口 | Chat、Responses、Claude，复用 DSH 内置适配器 |
| 密钥隔离 | 密钥交给 DSH 凭据服务，插件配置只保存凭据引用 |
| 可恢复 | 切回“跟随 DSH 原有行为”即可停止覆盖 |
| 中英文界面 | 跟随 DSH 语言和主题，提供设置入口及插件详情页入口 |
| 团队消息参数守卫 | 识别把子代理 UUID 当作队友名的调用，返回可纠正提示而不是原始堆栈 |
| DSH 版本适配 | 在缺少 `agent.model` 的 DSH（如 `0.2.1-rc.5`）上自动回退内部接口选择模型；路由校验失败则创建失败，绝不静默用错模型 |

## 安装

使用固定版本 [v1.1.1](<https://github.com/junjundesk/dsh-subagent-model/releases/tag/v1.1.1>)；[Latest 发布页](<https://github.com/junjundesk/dsh-subagent-model/releases/latest>)指向最新稳定版本。安装包和 Git 标签均包含已构建的客户端，无需编译，也没有 `postinstall` / `prepare` 脚本。

### 方式一：GitHub 标签安装（推荐）

1. 打开 DSH Web 的 **插件 → 添加插件**。
2. 输入以下完整安装地址，选择安装并启用：

   ```text
   github:junjundesk/dsh-subagent-model#v1.1.1
   ```

3. 按安装器提示刷新页面或重启 DSH。
4. 打开 **设置 → 子代理模型**。

命令行等价（需要 PATH 中已有 `pnpm` 和 Git；若目标 profile 正在运行，请先保存任务并退出）：

```bash
dsh plugin --profile web add "github:junjundesk/dsh-subagent-model#v1.1.1"
```

请安装固定标签而不是 `main`，以避免后续开发提交改变行为。该包从 GitHub 分发，**未发布到 npm registry**；不要用裸包名 `npm install dsh-subagent-model` 代替 DSH 安装流程。

### 方式二：安装编译好的 Release 包

从 [v1.1.1 发布页](<https://github.com/junjundesk/dsh-subagent-model/releases/tag/v1.1.1>)下载 [dsh-subagent-model-1.1.1.tgz](<https://github.com/junjundesk/dsh-subagent-model/releases/download/v1.1.1/dsh-subagent-model-1.1.1.tgz>) 与 [SHA256SUMS.txt](<https://github.com/junjundesk/dsh-subagent-model/releases/download/v1.1.1/SHA256SUMS.txt>)，校验后在 DSH **添加插件** 中输入下载文件的绝对路径。也可把固定版本的发布资产 URL 交给 CLI：

```bash
dsh plugin --profile web add "https://github.com/junjundesk/dsh-subagent-model/releases/download/v1.1.1/dsh-subagent-model-1.1.1.tgz"
```

### 安装后收尾

安装会默认启用新 bundle。之后重新启动目标 profile，并刷新浏览器：

```bash
dsh --version        # 先确认版本
dsh --profile web    # 使用其他 profile 时换成实际名称
```

目标 profile 需要挂载 DSH Web、模型、设置和凭据服务；纯 headless/TUI 不提供本插件界面。

> CLI 用法以 DSH `0.2.2-alpha.2` 为基准。不要手改 profile 的依赖文件或配置补丁，也不要在 profile 目录直接执行 npm/pnpm 来代替插件管理器。

## 支持的 DSH 版本

| DSH 版本 / 环境 | 状态 |
| --- | --- |
| **0.2.2-alpha.2，Windows Web profile** | **历史真实宿主验证（1.1.0，非完整浏览器 E2E）**：安装、Client 注册、Host 读写和真实子代理请求路由 |
| `0.2.1-rc.5` | 清单接纳（1.1.1 起）；静态比对 + 模型选择适配 + **组件级路由验证（22/22 PASS）**（`sessionController.agents.selectForNextRequest` 内部接口回退路径下请求配置覆盖正确）；**真实 LLM / 完整 agent-loop / 浏览器与网络 E2E 未做** |
| 低于 `0.2.1-rc.5` | 不支持，清单不接纳，不建议强行豁免版本限制 |
| 其他 `0.2.x` | 未逐一测试；安装器是否接纳由版本范围决定，不代表已验证兼容 |
| `0.3.0` 及以上（包括 `0.3.0` 预发布） | 当前清单不接纳，需后续适配 |
| macOS / Linux Web | 源码没有平台专用运行依赖，但尚未进行 DSH 端到端验证 |
| Headless、TUI、外部 Codex / Claude Code CLI | 不是本插件 UI 的支持目标 |

[package.json](<package.json>) 声明 `engines.dsh: ^0.2.1-rc.5`（即 `>=0.2.1-rc.5 <0.3.0-0`），插件自身声明 Node.js `>=22`；运行 DSH 还必须满足 DSH 自身的 Node 要求。**声明范围不是测试矩阵**：DSH 安装器开启 `includePrerelease: true`，预发布版本参与匹配——该范围从 `0.2.1-rc.5` 起接纳后续 `0.2.x`（实测 `0.2.1-rc.5` / `0.2.1` / `0.2.2-alpha.2` / `0.2.2` 均接纳），但严格排除 `0.3.0` 的预发布和正式版（1.1.0 的 `^0.2.2-alpha.2` 下限会拒绝 `0.2.1-rc.5`，1.1.1 已放宽）。完整判定矩阵见 [兼容性说明](<docs/COMPATIBILITY.md>)。

## 快速使用

### 使用 DSH 现有模型

1. 打开 **设置 → 子代理模型**。
2. 选择 **使用指定模型**。
3. 依次选择 **分组 / 服务商 → 模型 → 推理强度**。
4. 点击 **保存设置**。
5. 下次新建本地子代理时生效；“自动”表示目标模型默认强度，不沿用另一个模型的强度。

### 添加自定义 API

1. 展开 **添加自定义 API**。
2. 填写唯一分组标识、接口类型、基础地址、模型 ID、密钥以及真实 token 限制。
3. 只勾选服务商明确支持的推理强度；不知道时不要勾选。
4. 点击 **添加 API 分组**。
5. 新模型会填入上方草稿；确认强度后，再点击 **保存设置**。

| 界面类型 | 对应 DSH 协议 | 基础地址示例（不是测试承诺） |
| --- | --- | --- |
| Chat | `openai-completions` | `https://api.example.com/v1` |
| Responses | `openai-responses` | `https://api.example.com/v1` |
| Claude | `anthropic-messages` | `https://api.anthropic.com` |

分组自动使用 `dsh-subagent-` 前缀。后续编辑分组、地址和密钥，请使用 DSH 的 **设置 → 模型**。详细字段说明、恢复方式和错误排查见 [使用教程](<docs/USAGE.md>)。

## 生效边界与安全

- 设置影响**当前 profile 的所有会话**，但只在**新建本地子代理**时应用，包括 spawn、fork 和走相同本地子代理机制的团队成员。
- 主代理、已创建/运行的子代理和恢复的子代理不改动。给旧子代理继续发消息不会自动换模型。
- 不改原生模型授权白名单。委派时可省略 provider/model/effort；显式指定未获授权的路由仍可能先被 DSH 拒绝。
- 固定设置会覆盖进入创建阶段的子代理初始模型选择；无效目标会失败，不静默回退到其他模型。
- 外部 Codex CLI、Claude Code CLI、ACP 等独立进程的模型不受本插件控制；fork 跨模型可能降低缓存复用。
- 自定义 API 会收到子任务及工具结果，fork 还包含继承的对话。请仅使用可信服务商；HTTP 不加密。
- 密钥不进入插件源码、配置明文、浏览器 localStorage 或工具参数。**DSH 本地凭据存储不等于操作系统保险箱**，同一系统账户的进程仍可能访问底层文件。
- 密钥保存和分组保存没有跨服务事务；部分成功会明确提示。不要盲目重复添加。
- 禁用/卸载本插件不会主动删除原生模型分组和凭据，需在 DSH 模型设置中管理。

## 团队消息参数守卫（1.1.0）

Agent Teams 的 `send_message` / `interrupt_agent` 的 `target` 必须是 `list_agents` 返回的**队友名字**（如 `lead`），而子代理/会话 id 是 UUID。二者格式相似，模型容易传错，DSH 原生会抛出 `active teammate "<uuid>" not found`。

本插件在调用前做防御性校验：

- 把“某个队友的会话 id”自动识别出来，并在错误里给出应使用的名字。
- 传入未知名字、UUID、`provisioning` / `failed` 队友时返回可纠正提示，而不是原始堆栈。
- 合法调用（`lead`、有效队友名、子代理控制工具的 `agent_id` 形式）完全不受影响。
- 挂载 Agent Teams 时额外注册一条很短的提示，引导模型先 `list_agents` 并使用 `target`。
- 插件**不能改写**工具参数：DSH 的 `tools/pre-execute` 只允许 allow/deny/ask，`tools/execute` 只允许更换 signal。因此这里采用“校验 + 可纠正拒绝”，而不是篡改调用。
- 不想启用时，在 profile 配置中把本插件的 `guardTeamTargets` 设为 `false`。该守卫不改模型，也不影响非 Teams profile。

## 升级、禁用与卸载

- **升级前**：记录当前固定模型与强度，确认新版本的 DSH 支持范围。若安装器拒绝覆盖已安装版本，按它的提示卸载旧插件，再安装新标签；检查设置是否需要重新选择。
- **临时停用固定路由**：在设置中选“跟随 DSH 原有行为”并保存。
- **禁用或卸载**：在 DSH 插件页操作。不会停止已经在运行的子代理，也不会删除其历史。
- 若页面仍显示旧版报错，先关闭设置面板并重新打开，再强制刷新；仍未更新时按安装器提示重启当前 DSH profile。

CLI 升级可在退出当前 profile 后再次执行 `dsh plugin --profile web add`，把参数中的标签换成**已经发布**的新标签；固定 tag 的依赖不会因为普通 update 就自动跳到新 tag。升级已有包后需要重启 profile。CLI 卸载命令为：

```bash
dsh plugin --profile web remove dsh-subagent-model
```

## 开发

```bash
git clone https://github.com/junjundesk/dsh-subagent-model.git
cd dsh-subagent-model
npm ci --ignore-scripts
npm run build
npm run check
npm test
npm pack --ignore-scripts
```

- [index.js](<index.js>)：Host Config、子代理创建钩子、Agent 工具。
- [logic.js](<logic.js>)：Host 和 UI 共享的校验、配置写入与结果验证。
- [client.source.js](<client.source.js>)、[style.css](<style.css>)、[locale/zh.json](<locale/zh.json>)：界面源码与本地化。
- [build.mjs](<build.mjs>)：生成并提交 [client.js](<client.js>)，GitHub 安装不需要编译。
- [test/logic.test.mjs](<test/logic.test.mjs>)、[test/client-contract.test.mjs](<test/client-contract.test.mjs>)：行为与 Client 注入契约测试。

本地开发安装请通过 DSH 插件页选择本仓库绝对路径。修改后重新构建，遵循安装器的重载/重启提示；不承诺在没有开发 watcher 的情况下自动热更新。自动化测试不替代真实 UI 或服务商连通性验证，见 [验证记录](<TESTING.md>)。

## Agent 工具

`dsh_subagent_model` 提供 `status`、`catalog`、`select`、`inherit`、`add_api`。写操作需要最新 revision；新增 API 使用已保存的凭据引用，不接受密钥值。子代理可以读取状态/目录，不能通过该工具修改 profile 全局路由。

## 反馈与许可

遇到问题请提交 [Issue](<https://github.com/junjundesk/dsh-subagent-model/issues>)，附插件版本、`dsh --version`、操作系统、操作步骤和脱敏错误。**不要公开 API 密钥、完整会话日志或 profile 配置**。

[MIT License](<LICENSE>)；[插件 SVG 图标](<icon.svg>)为原创，同样以 MIT 分发。
