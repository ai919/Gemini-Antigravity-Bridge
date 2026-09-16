# 🤖 AGENTS.md - 架构设计与智能体开发规范

> 本文档为智能体协作规范与系统架构指引。保持高信息密度与精简，避免重复冗余。

---

## 1. 核心定位与技术栈
- **定位**：连接 **Google Gemini 网页版**（200 万超大上下文、0 Token 费用）与 **本地代码工程** 的 Chrome 侧边栏 Agent 伴侣。
- **扩展层 (Extension MV3)**：Vanilla JS / HTML / CSS，驻留于 Chrome Side Panel，不依赖臃肿前端框架。
- **通信层**：Chrome Extension 与本地 Daemon 经由 WebSocket（`ws://127.0.0.1:3456`）双向通信。
- **守护端 (Daemon)**：Node.js 18+ 原生服务，负责文件 I/O、Diff 合并、终端命令沙箱与系统弹窗。
- **原生桥接**：C# 编写的微型 `picker.exe` 负责非阻塞呼出 Windows 原生目录选择框。

---

## 2. 核心架构与数据流

```text
Chrome Side Panel (UI交互)
  ├── 输入框多模态截图粘贴 (Ctrl+V) / 斜杠技能补全 (/skill)
  ├── 三栏抽屉：[现有项目] | [历史会话] | [新建逻辑]
  └── 自动落盘开关 (Auto-Apply) & Diff 卡片预览
        │
        │ WebSocket (ws://127.0.0.1:3456)
        ▼
Local Workspace Daemon (Node.js)
  ├── SQLite 动态解析器 (antigravity-db.js) <- ~/.gemini/antigravity/conversation_summaries.db
  ├── 磁盘持久化 (SessionStore) <- <workspace>/.gemini-bridge/sessions/*.json
  ├── 代码合并引擎 (DiffPatcher) <- 自动备份至 .gemini-bridge-backups/
  ├── 本地技能扫描 (SkillLoader) <- ~/.gemini/config/skills/
  └── 原生选择器 (picker.exe) <- Windows IFileOpenDialog
```

---

## 3. 数据持久化与真理之源 (Source of Truth)
1. **项目与原生对话**：真理之源在 `~/.gemini/antigravity/conversation_summaries.db`。**严禁硬编码项目列表**，必须通过 `project_id` 和 `workspace_uris` 纯动态解析。
2. **本地 Bridge 对话**：存储在当前工作区目录 `<workspace>/.gemini-bridge/sessions/<session_id>.json`，与 Git 项目同生命周期。
3. **文件写入与备份**：所有自动落盘或手动 Accept 写入，必须先将旧文件完整快照备份到 `<workspace>/.gemini-bridge-backups/<timestamp>_<file>`。

---

## 4. 协作开发与代码规范 (Agent Rules)
1. **Windows 路径处理**：必须使用 `norm(p) = path.resolve(path.normalize(p)).toLowerCase()` 统一规范化，避免反斜杠与大小写导致比对失败。
2. **UI 弹窗交互契约**：所有抽屉（Drawer）、浮窗（Menu）必须配有暗色遮罩层，且支持「点击外部遮罩」与「按 Esc 键」自动收缩退出。
3. **项目管理三栏规范**：
   - 保持 Antigravity 原生体验：左栏专注「现有项目」，中栏展示「所属会话」，右栏专注「新建项目/对话」。
   - 不得把计算机根目录暴露为项目。新建项目必须调起原生选择器。
4. **终端执行安全**：子进程命令执行必须强制设置 `chcp 65001`（UTF-8），避免中文系统控制台乱码。
