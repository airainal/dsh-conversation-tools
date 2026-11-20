# 会话工具（Conversation Tools）

给 DeepSeek Harness Web UI 补三个功能，全部通过公开 Slot 与已有 Host Remote 实现，不改动任何内置包：

1. **文件链接右键菜单**：对话里蓝色的文件名（Markdown 文件链接、行内代码解析出的文件引用）右键弹出「在文件管理器中打开 / 用默认应用打开」，走 `session.openWorkspacePath`，由 Host 校验路径后再调用系统打开器。相对路径按当前会话工作目录解析；失败时菜单里直接显示 Host 返回的错误码。
2. **就地编辑已发送消息**：鼠标移到已发送的用户消息上，时间/复制那一行左侧出现「编辑」；点击后**消息气泡本身**变成编辑框（原气泡被一张同色浮起卡片覆盖，不跳到下方输入框）。卡片右缘对齐气泡右缘、向左展开到至少 340px（短消息「你好」也不会被挤成一列竖排），无边框，靠左上白色柔光 + 右下投影做新拟态上浮，聚焦时再抬 1px；深色主题单独一套阴影。改完点「发送」（或 Ctrl+Enter）后：
   - 先在**这条消息之前**的历史边界上新开一个分支会话（`session.fork`，`atSeq = 消息序号 - 1`），原会话完整保留；
   - 把编辑后的文本作为新分支的第一条消息发送（`session.prompt`），并自动切到该分支；
   - 万一取不到消息序号或分支创建失败，退回「在当前会话作为新消息发送」，并提示「无法创建分支，已作为新消息发送」。
3. **手动压缩上下文**：输入框下方、上下文占用圆环左侧新增「压缩」按钮，点击执行会话已有的 `/compact` 命令；上下文占用 ≥75% 时按钮转为警示色。命令目录读不到时按钮仍然显示（点击后用 Host 的报错提示），只有明确读到目录里没有 `compact` 才隐藏。

## 一个容易踩的坑：Remote 命名空间是独立服务

`ctx.remote.session` 这类访问只对**声明过** `remote.session` 的注入上下文有效；**`ctx.get('remote')` 返回的只是父 facade，`.session` / `.commands` 永远是 `undefined`**。本插件因此统一用 `ctx.get('remote.session')`、`ctx.get('remote.commands')`（见 `remoteNamespace()`），第一版用 `ctx.get('remote').session` 导致右键菜单"点了没反应"、压缩按钮完全不出现。

## 自动压缩是否已经存在

已经存在，无需新增：本部署的两个 Agent 预设（`standard`、`cordis`）都挂了 `compaction` 组
（`dsh-compaction-basic` + `dsh-command-compact` + `dsh-compaction-tool-result-pruner`），默认阈值
`thresholdRatio: 0.8`，并带上下文溢出后的「压缩后重试」恢复。到上限时不会静默中断会话，而是先压缩较早历史；
只有无法再压缩（例如单条不可拆分的大单元）时这一轮才会以错误结束。

## 为什么有的会话不弹「编辑」

两条真实原因，都已修：

1. **消息在上一轮还在跑时发出，DSH 会按 `steering` 渲染。** 它和普通消息是同一个气泡、同一行复制/时间图标，但 `data-chat-flow-kind` 是 `steering` 而不是 `user`。旧版只匹配 `user`，所以这类消息（常见于边跑边补充、连续追问的长会话）永远不弹按钮，看起来就是"这个会话坏了"。现在 `user` 与 `steering` 都算可编辑消息（`EDITABLE_FLOW_KINDS`），提交时仍按「这条消息之前分叉」处理，分叉失败会回退成新消息并提示。
2. **编辑面板可能卡在不可见状态。** 打开编辑框后如果这条行被重渲染/压缩裁掉，旧版会把编辑框留在隐藏位置，而 `editing` 状态一直为真，于是该会话之后所有悬停都被短路——表现同样是"整个会话都不弹"。现在行断开时会自动收起编辑框（`pointerover` 与每次重新测量时各检查一次）。

## 安装

已通过 `plugin_manager` 安装为本地链接包（profile `desktop`），改本目录文件后**刷新页面**即可；若刷新后行为没变，重启一次 DeepSeek Harness（客户端模块在启动时装载）。

Host 半部为空（不发请求、不注册 Tool）；Client 半部只注册两个 Slot 条目：

- `conversation.input.overlay#conversation-tools`（不可见，渲染右键菜单、悬停编辑按钮、就地编辑面板三个 portal）
- `conversation.composer.dock#context-compact`（压缩按钮，order 2，紧贴圆环左侧）

## 自检

```powershell
node scripts/smoke.cjs        # 模块形状 / 字典完整性 / Remote 命名空间解析 / 分叉与发送接线
node scripts/paths.test.cjs   # 路径解析（Windows、POSIX、file://、相对路径）
node scripts/rows.test.cjs    # 哪些聊天行算"用户消息"（user / steering）
```

脚本默认使用随应用附带的 Node：

```powershell
& "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" scripts\smoke.cjs
```
