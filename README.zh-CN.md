# pi-web

[English](./README.md)

[pi 编程智能体](https://github.com/badlogic/pi-mono) 的本地网页界面。它会读取本机的 pi 会话文件，在浏览器里提供会话管理、实时对话、模型配置、技能管理和项目文件预览。

## 快速开始

**无需安装，直接运行：**

```bash
npx @agegr/pi-web@latest
```

**或全局安装后使用：**

```bash
npm install -g @agegr/pi-web
pi-web
```

启动后打开 [http://localhost:30141](http://localhost:30141)。命令行版本会在服务就绪后尝试自动打开浏览器。

**可选参数：**

```bash
pi-web --port 8080              # 自定义端口
pi-web --hostname 127.0.0.1     # 仅本机访问
pi-web -p 8080 -H 127.0.0.1     # 组合使用
pi-web --no-open                # 不自动打开浏览器

PORT=8080 pi-web                # 也支持环境变量
PI_WEB_NO_OPEN=1 pi-web         # 适用于后台服务或开机自启
```

## 功能介绍

- **把历史工作接回来**：打开网页就能按项目找到以前的 pi 对话，不必在终端里翻文件或记住会话路径。
- **让重要会话随手可达**：可以跨项目固定会话，使用滚动十天窗口的 Recent 列表，也可以在侧边栏隐藏不需要的 Fork 子树，并用“显示隐藏会话”临时查看。
- **放心试不同方向**：可以从历史消息处编辑、在某条旧提示之前 Fork，或运行 `/clone` 复制当前完整活动分支，探索方案时不怕弄乱原来的对话。
- **跨分支工作**：在侧边栏切换 Git worktree，让新会话和 Explorer 跟随你选择的 checkout。
- **边聊边看项目文件**：左侧浏览项目文件，右侧打开源码、文档、图片、音频和 PDF；文件变化会自动刷新，适合边让 agent 改边检查结果。
- **随时掌握会话状态**：在顶部就能看到上下文占用、花费、压缩结果和系统提示，长会话不再像黑箱。
- **少离开当前界面**：模型、登录/API key、模型测试和技能开关都能在网页里处理，配置 agent 时不用在多个工具之间来回切换。

## 注意事项

- **数据目录**：默认读取 `~/.pi/agent/sessions` 下的会话文件。可通过环境变量 `PI_CODING_AGENT_DIR` 指定其他 pi agent 目录。
- **会话文件**：路径形如 `~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`。
- **侧边栏状态**：固定会话和显式隐藏标记通过 pi agent 目录下的 `pi-web-sidebar.json` 在多个 pi-web 客户端之间共享。隐藏只影响显示，不会移动或重写会话 JSONL、改变固定状态，也不会停止正在运行的会话。Pi Web 不提供永久删除会话的功能。
- **模型配置**：Models 面板读写 pi agent 目录下的 `models.json`，模型列表和默认模型由 pi 的配置解析得到。
- **文件访问**：文件浏览和预览面向当前选择的项目目录，以及会话中已出现过的工作目录。
- **Git worktree**：什么时候显示切换器、新建目录在哪里、删除会影响什么，见 [pi-web 里的 Worktree](./docs/worktrees.zh-CN.md)。
- **三种分支操作**：“Edit from here” 在当前会话文件内创建分支；Fork 从选中的历史提示之前创建子 `.jsonl` 并打开它；`/clone` 把直到当前位置的完整活动分支创建为普通子会话，pi-web 会刷新侧边栏，但仍停留在源会话。
- **Clone 的宿主边界**：`/clone` 使用 Pi 原生的会话文件提取和父子关系格式，但不会替换当前 Web 会话，也不会触发 TUI 的 fork/clone 扩展生命周期事件。

## 开发

### 本地 Pi Fork 前置条件

此 checkout 有意使用由 `bac2qh/pi` 提交 `734502cb86eaf631e1ceeb403dbd717e3b78404f` 构建的本地、未跟踪 coding-agent tarball。它不会使用全局 Pi 安装，而且当前形态不可发布。

请使用 Node `24.19.0` 和 npm `11.17.0`，并让保留的 main checkout 互为同级目录：

```text
<repos>/pi-web/
<repos>/pi/
```

同级 `pi` checkout 必须保持干净，`origin` 必须指向 `bac2qh/pi`，并且 `HEAD` 必须是上面的精确提交。在保留的 `pi-web` main 中运行：

```bash
npm run build:local-pi-fork
npm run install:local-pi-fork
npm run dev
```

该 helper 会从精确提交创建两套全新构建，运行 Fork 的检查、测试、构建、local-release 流程和聚焦的 faux-provider 压缩回归；只有两个归档逐字节一致时，才会原子发布到：

```text
../pi/.artifacts/pi-web/734502cb8/bac2qh-pi-coding-agent-0.84.0-bac2qh.734502cb8.tgz
```

此产物已被 Fork 忽略，必须在本机重建；它不会全局安装，也不会从自定义包发布中下载。为避免可变的模型目录输入，helper 会先从未改动的官方 `@earendil-works/pi-ai@0.84.0` 产物补齐生成模型数据，再运行精确 Fork 的验证流程。`npm run install:local-pi-fork` 会先校验磁盘上的产物身份和已提交完整性，再运行禁用脚本的 `npm ci`，因此即使 npm 缓存已预热，也不能掩盖缺失或过期的同级产物。它不会退回 registry coding-agent；请重新运行构建 helper（如果它报告字节不匹配，只保留或删除那个精确的旧产物）。

已提交的 `file:../pi/...` 路径以保留的 `pi-web` main 为基准。位于 `.agents/worktrees/` 下的嵌套受管 checkout 不具备该同级布局；请在一次性的 `pi-web`/`pi` 同级副本中验证，不要创建假的 worktree，也不要修改 manifest 路径。

本地开发端口为 [http://localhost:30141](http://localhost:30141)。

常用检查：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

开发时不要运行 `next build` / `npm run build`，它会写入 `.next/`，容易影响正在运行的 dev server。发布流程再执行构建。

## 项目结构

```
app/
  api/
    agent/          # 创建/驱动 AgentSession，提供 SSE 事件流
    auth/           # OAuth 和 API key 管理
    cwd/validate/   # 自定义工作目录校验
    default-cwd/    # 获取 pi 默认工作目录
    files/          # 文件列表、读取、预览、watch
    home/           # 当前用户 home 目录
    models/         # 可用模型、默认模型、thinking levels
    models-config/  # 读写 models.json、测试模型
    sessions/       # 会话读取、重命名、上下文、HTML 导出
    sidebar-state/  # 共享的固定/隐藏操作 API
    skills/         # skills 列表、搜索、安装、启停
components/
  AppShell.tsx        # 主布局、URL 状态、顶部面板、文件标签
  SessionSidebar.tsx  # Pinned/Recent/Project 分区和 Explorer
  ChatWindow.tsx      # 消息区、SSE、拖拽图片、minimap
  ChatInput.tsx       # 输入栏、模型/工具/thinking/compact/slash controls
  MessageView.tsx     # 消息、thinking、tool call/result 渲染
  ModelsConfig.tsx    # 模型和认证配置面板
  SkillsConfig.tsx    # 技能管理面板
  FileExplorer.tsx    # 文件树
  FileViewer.tsx      # 源码、diff、图片、音频、PDF、DOCX 预览
lib/
  rpc-manager.ts      # AgentSessionWrapper 生命周期和全局 registry
  session-reader.ts           # 解析 .jsonl 会话文件和分支上下文
  sidebar-session-state.ts    # 固定/隐藏/Recent/树的纯派生逻辑
  sidebar-state-store.ts      # 带锁原子写入 pi-web-sidebar.json
  normalize.ts                # 规范化 toolCall 字段名
  file-access.ts      # 文件读取安全边界
  file-paths.ts       # 文件路径编码/相对路径工具
  markdown.ts         # Markdown/Mermaid/KaTeX 插件配置
  pi-types.ts         # pi 相关类型
hooks/
  useAgentSession.ts  # 会话加载、发送命令、SSE 状态机
  useAudio.ts         # 完成提示音
  useDragDrop.ts      # 图片拖拽
  useTheme.ts         # 主题切换
bin/
  pi-web.js           # npm CLI 入口
```
