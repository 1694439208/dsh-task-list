# DSH 任务列表

[English](./README.en.md) · 社区插件，非 DeepSeek 官方产品

[npm 安装页](https://www.npmjs.com/package/@kaifeise/dsh-task-list) · [GitHub 发布包](https://github.com/1694439208/dsh-task-list/releases) · [问题反馈](https://github.com/1694439208/dsh-task-list/issues)

仓库按 [DeepSeek Harness 官方建议](https://github.com/deepseek-ai/deepseek-harness#community-and-support) 添加 `dsh-plugin` 主题，便于生态检索；这不表示官方审核或背书。运行代码与已公开发布的 npm `1.3.1` 一致，仓库另补充了来源元数据和文档链接。

在 DeepSeek Harness 左下角增加“任务列表”入口，打开弹窗即可跨工作区查看会话，点击一项直接跳转。不必逐个项目寻找刚执行完的对话。

## 功能

- **完成后仍保留**：展示所有未归档、非空白的普通会话，不会因为运行结束、已查看或关闭弹窗而移除。
- **新完成提醒**：只有本次页面插件启用后新完成、结果明确为正常结束、且尚未查看的会话亮绿点。旧完成会话显示灰色“已完成”，不会全部亮绿。
- **打开后消点，不删记录**：进入会话后由 DSH 的正常已读机制清除绿点；该会话继续留在列表中。
- **区分状态**：运行中用动态标记；等待批准、审核、回答或执行用黄点；明确失败用红点；取消、中断和未知结果分别显示。
- 按最近活动排序，显示标题和工作目录；当前会话高亮，长列表可滚动。
- 不单独列出子代理；父会话仍有运行中子任务时显示相应状态。
- 支持中英文界面、宿主主题、Escape 关闭及原生模态焦点约束。

## 安装

在 DSH 的插件管理中选择“添加插件”或“按包名安装”，输入：

```text
@kaifeise/dsh-task-list
```

使用 DSH 命令行和 `desktop` 配置时，也可执行：

```sh
dsh plugin --profile desktop add @kaifeise/dsh-task-list
```

安装依赖交给 DSH 插件管理器处理，不要手工改写个人配置目录。

**如果使用过本地测试版**：先在插件管理器中停用或移除 `@local/dsh-task-list-unread`、`@local/dsh-task-list`、`@local/dsh-running-sessions`，不要与公开版同时启用，以免重复入口或投影域冲突。停用插件不会删除会话。

更新后如界面仍显示旧版，请先确认安装已成功；在运行任务安全结束后重新打开 DSH，不要为了刷新插件中断正在执行的任务。

## 使用

1. 点击左下角设置旁的“任务列表＋数量”。
2. 弹窗展示所有工作区中的未归档普通会话。数量表示列表会话总数，而不是仅运行中的数量。
3. 点击标题进入对话；点击关闭按钮、弹窗外部或按 Escape 关闭。
4. 将会话归档后，它才从此列表隐藏。

### 绿点的含义

绿点是**新完成且未查看的提醒**，不是永久成功标签。正在查看的会话结束时通常不会产生未读绿点。刷新页面或重新加载插件后，开始新一轮页面级提醒，但会话和完成结果不会被删除。

“已完成”指最新 Agent 回合以 `completed` 正常结束，不代表插件逐项核验了外部业务结果。未取得明确结果时显示“结果待确认”，不会仅因为会话停止运行就标绿。

## 兼容与验证范围

- 面向 DSH `0.2.1-rc.5` 至 `0.2.1` 系列，以及 `0.2.2-rc.1` 至 `0.2.2` 系列；安装时以包内 `engines.dsh` 的精确约束为准。未验证其他系列版本。
- 使用 DSH 提供的 React、标准 Slot hooks、`sessionProjections` 和 `uiWorkspace` 服务；不附带另一份 React。
- 需要支持原生 `<dialog>`、`IntersectionObserver` 和 CSS `color-mix()` 的现代浏览器或对应 Desktop WebView。
- 已完成 69 项数据、结果投影、提醒、读取队列和视图状态回归测试；构建与语法检查通过。曾在 DSH `0.2.1-rc.5` 环境进行安装检查，当前 `0.2.2-rc.1` 页面已确认新版入口注册为 active。
- 上述检查不是完整浏览器端到端或跨平台视觉测试；未声称所有主题、键盘焦点及平台外观均已验收。

## 数据与安全

插件通过两个 additive 插槽扩展界面，不替换原工作区浏览区。Host 对现有 `turn/start`、`turn/end` 事件做增量投影，Client 不扫描会话日志。

历史结果缺少投影时，仅在行进入弹窗可视范围后读取，最多并发 4 个并去重；不启动 Agent、不保留历史流、不触发迁移。页面级未读状态沿用 DSH 自身机制。

插件不提交提示词，不创建、取消或终止任务，不追加会话事件，不向外部服务上传会话数据，不收集遥测。安装时 npm/DSH 会正常下载声明的依赖。

## 开发

```sh
npm install --ignore-scripts
npm test
npm run build
npm pack --ignore-scripts
```

源码和已构建的浏览器模块均包含在包内；正常安装不需要额外构建。Host 的 Zod 校验库作为显式依赖发布，无安装脚本。

## 许可

MIT，见 [LICENSE](./LICENSE)。列表图标为原创。DeepSeek Harness 及 Zod 的名称与权利分别归其所属权利人所有；本插件不表示官方认可或关联。
