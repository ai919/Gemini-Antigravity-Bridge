# 📋 PROJECT_LOG.md

## 2026-09-16 任务迭代记录

### 1. 本次完成内容
- **⚡ 自动落盘与覆盖更新**：实现「⚡ 自动落盘」配置持久化（localStorage 记忆），Gemini 产出代码修改后自动秒级写入本地磁盘，并在 `.gemini-bridge-backups/` 保留时间戳快照。
- **⚡ 技能斜杠快捷指令 (`/skill`)**：在输入框输入 `/` 实时呼出本地技能菜单（自动扫描 `~/.gemini/config/skills/`），支持键盘方向键与回车选择，自动装载技能的 System Instruction 提示词。
- **🎯 遮罩层点击收缩与 Esc 退出**：为所有侧滑抽屉（项目管理抽屉、会话抽屉、技能弹窗）配置全局暗色磨砂遮罩层，支持点击空白区域自动收起与 Esc 快捷键关闭。
- **📁 Antigravity 风格三栏项目与会话分级体系**：
  - 左栏（现有项目）：展示 Antigravity 识别的本地真实工程（名称、路径、会话计数、快捷 `+` 按钮）。
  - 中栏（历史会话）：展示选中项目下的完整历史对话，支持切换、进入工作区与删除。
  - 右栏（新建操作）：将新建逻辑完全隔离，提供「➕ 新建项目」（呼出系统原生目录选择器）与「💬 新建对话」。
- **🖥️ Windows 原生文件夹选择器（解决弹窗阻塞）**：编写编译轻量 C# 工具 `daemon/picker.exe`（直接调用 Windows Vista+ 的 `IFileOpenDialog`），彻底解决 PowerShell/rundll32 弹窗阻塞与呼不出窗口的问题。
- **🔄 100% 动态读取 Antigravity 原生数据库**：重构 `daemon/antigravity-db.js`，彻底移除静态硬编码，完全基于本机 `~/.gemini/antigravity/conversation_summaries.db` 与文件系统动态提取推导，实现实时感知。

---

### 2. 修改与新增文件列表
| 文件路径 | 类型 | 说明 |
| :--- | :---: | :--- |
| `daemon/antigravity-db.js` | 核心修改 | 纯动态解析 Antigravity SQLite 数据库，按项目与工作区分组聚合会话 |
| `daemon/server.js` | 核心修改 | 增加 `PICK_FOLDER`、`GET_WORKSPACES_TREE` 接口，整合原生选择器与项目树同步 |
| `daemon/picker.cs` / `daemon/picker.exe` | 新增 | C# 编译的 Windows 原生文件选择器，解决弹窗失去焦点与阻塞问题 |
| `extension/sidepanel/sidepanel.html` | 核心修改 | 重构抽屉为 3 栏式分级布局（项目 / 会话 / 新建面板），增加遮罩层结构 |
| `extension/sidepanel/sidepanel.css` | 核心修改 | 适配 3 栏式抽屉布局、磨砂遮罩、hover 操作按钮及高亮样式 |
| `extension/sidepanel/sidepanel.js` | 核心修改 | 接入三栏联动逻辑、自动落盘开关、技能补全弹窗、点击外部自动收起 |
| `README.md` | 更新 | 补充项目认知、自动落盘、斜杠技能与三栏项目管理文档说明 |
| `PROJECT_LOG.md` | 新增 | 记录本次开发轨迹、架构变更与排障经验 |
| `AGENTS.md` | 新增 | 定义项目核心规范、技术栈架构与 AI 维护准则 |

---

### 3. 关键实现方式
1. **纯动态数据库解析 (`daemon/antigravity-db.js`)**：
   - 通过子进程 Python 执行 SQLite 查询拉取 `conversation_summaries`。
   - 以 `project_id` 为主键聚合工作区 URI 与会话，通过 `fs.existsSync` 与目录层级动态推导工程显示名。
   - 编写 `norm(p)` 辅助函数统一解析盘符大小写与路径斜杠，确保激活态与路径匹配完全准确。
2. **轻量原生选择器 (`daemon/picker.exe`)**：
   - 采用 C# P/Invoke 调用底层 COM 组件 `CLSID_FileOpenDialog` 与选项 `FOS_PICKFOLDERS`。
   - 父窗口句柄指定为桌面（`IntPtr.Zero`），保证弹窗前台置顶且不挂起主 Node.js 事件循环。
3. **三栏联动状态流 (`extension/sidepanel/sidepanel.js`)**：
   - `projectsTreeData` 数据驱动 UI 渲染。
   - 左栏切换激活项目并持久化 `selectedProject`；中栏同步过滤渲染会话；右栏分流全局新建行为。

---

### 4. 遇到的问题与解决方案
- **问题 1：Windows 文件夹选择弹窗偶尔弹不出或被挂起**  
  *原因*：PowerShell COM 脚本在无前台控制台或 MTA 模式下容易失去窗口焦点或被系统进程阻塞。  
  *解决*：编写编译独立的 `picker.exe` 原生工具，直接调用 `IFileOpenDialog`，毫秒级唤起且稳定回传路径。
- **问题 2：误将整个计算机根目录当成工作区展示**  
  *原因*：早期版本采用了直接扫描磁盘驱动器目录的粗暴方式，不符合 Antigravity 聚焦于已有工程的交互习惯。  
  *解决*：重构成三栏分级结构，左侧仅展示已有的本地工程与历史项目，新建目录独立引导。
- **问题 3：项目名称一度依赖临时静态匹配**  
  *原因*：数据库中历史记录存在多个别名（如 `915` 与 `xiaoshuo` 共用相同项目 ID）。  
  *解决*：构建优先级推导规则（优先存在真实物理目录、优先具名非纯数字名称），彻底消除硬编码。
