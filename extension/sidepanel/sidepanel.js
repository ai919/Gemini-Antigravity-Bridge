let ws = null;
let currentWorkspace = '未连接';
let cachedContext = null;
let currentTurnAssistantBubble = null;

let projectSessions = {};
let currentSessionId = 'sess_default';
let recentWorkspaces = [];

// DOM Elements
const daemonDot = document.getElementById('daemon-dot');
const daemonStatus = document.getElementById('daemon-status');
const activeWorkspaceName = document.getElementById('active-workspace-name');
const switchWsBtn = document.getElementById('switch-ws-btn');
const initProjectBtn = document.getElementById('init-project-btn');

const drawerModal = document.getElementById('drawer-modal');
const closeDrawerBtn = document.getElementById('close-drawer-btn');
const projectsDrawerBtn = document.getElementById('projects-drawer-btn');
const btnOpenProjects = document.getElementById('btn-open-projects');
const btnOpenTasks = document.getElementById('btn-open-tasks');

const cascadeProjectsList = document.getElementById('cascade-projects-list');
const cascadeTasksList = document.getElementById('cascade-tasks-list');
const selectedProjectTitle = document.getElementById('selected-project-title');
const btnSwitchToProject = document.getElementById('btn-switch-to-project');
const projectsCount = document.getElementById('projects-count');
const tasksCount = document.getElementById('tasks-count');

const drawerNewSessionBtn = document.getElementById('drawer-new-session-btn');
const treeSearchInput = document.getElementById('tree-search-input');
const pickFolderBtn = document.getElementById('pick-folder-btn');

let projectsTreeData = [];
let collapsedProjects = {};
let selectedDrawerProjectPath = null;

const currentSessionLabel = document.getElementById('current-session-label');
const newSessionBtn = document.getElementById('new-session-btn');
const newWsInput = document.getElementById('new-ws-input');
const addWsBtn = document.getElementById('add-ws-btn');

const chatMessages = document.getElementById('chat-messages');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const attachContextCheckbox = document.getElementById('attach-context');
const imagePreviewContainer = document.getElementById('image-preview-container');
const attachImgBtn = document.getElementById('attach-img-btn');
const hiddenFileInput = document.getElementById('hidden-file-input');
const skillsPopup = document.getElementById('skills-popup');
let pendingImages = [];
let availableSkills = [];
let activeSkillIndex = 0;

// Explicit Save Session by ID to Project Disk
function saveSessionById(sId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!sId || !projectSessions[sId]) return;

  ws.send(JSON.stringify({
    type: 'SAVE_SESSION',
    session: projectSessions[sId]
  }));
}

function saveCurrentSession() {
  if (currentSessionId && projectSessions[currentSessionId]) {
    projectSessions[currentSessionId].html = chatMessages.innerHTML;
    projectSessions[currentSessionId].updatedAt = Date.now();
    saveSessionById(currentSessionId);
  }
}

// Cleanly Render Chat for Target Session
function renderSessionChat(targetSessionId) {
  // 1. Clear viewport completely
  chatMessages.innerHTML = '';
  currentTurnAssistantBubble = null;

  const sess = projectSessions[targetSessionId];
  if (!sess) return;

  // 2. Update header title
  if (currentSessionLabel) {
    const displayTitle = sess.title || '对话';
    currentSessionLabel.innerText = displayTitle.length > 8 ? displayTitle.slice(0, 8) + '..' : displayTitle;
    currentSessionLabel.title = displayTitle;
  }

  if (sess.html && sess.html.trim().length > 0) {
    chatMessages.innerHTML = sess.html;
  } else {
    // Brand new clean conversation screen
    chatMessages.innerHTML = `
      <div class="message system-msg">
        <strong>⚡ 欢迎进入【${escapeHtml(sess.title)}】！</strong><br>
        📁 当前工作区: <code>${escapeHtml(currentWorkspace)}</code><br>
        💡 这是一个全新的独立任务对话，与网页版 Gemini 专属会话 1:1 双向绑定。<br>
        🚀 在下方输入你的编程任务，代码将自动写入当前工程。
      </div>
    `;
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
  rebindCardActions();
}

function rebindCardActions() {
  document.querySelectorAll('.apply-btn').forEach(btn => {
    if (btn.classList.contains('bound')) return;
    btn.classList.add('bound');
    btn.addEventListener('click', () => {
      const card = btn.closest('.diff-card');
      const patchContent = card.getAttribute('data-patch');
      if (patchContent && ws) {
        btn.disabled = true;
        btn.innerText = '正在写入...';
        ws.send(JSON.stringify({ type: 'APPLY_DIFF', patch: patchContent }));
        window.lastClickedApplyBtn = btn;
      }
    });
  });

  document.querySelectorAll('.command-btn').forEach(btn => {
    if (btn.classList.contains('bound')) return;
    btn.classList.add('bound');
    btn.addEventListener('click', () => {
      const cmd = btn.getAttribute('data-cmd');
      if (cmd && ws) {
        btn.disabled = true;
        ws.send(JSON.stringify({ type: 'RUN_COMMAND', command: cmd }));
      }
    });
  });
}

// Path Normalization and Comparison Helpers
function normalizePath(p) {
  if (!p) return '';
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function pathEquals(p1, p2) {
  return normalizePath(p1) === normalizePath(p2);
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);
  if (diffSec < 60) return '刚刚';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d`;
}

// Drawer Controls
function openDrawer(focusTarget = 'projects') {
  drawerModal.classList.remove('hidden');
  if (!selectedDrawerProjectPath || selectedDrawerProjectPath === '未连接') {
    selectedDrawerProjectPath = currentWorkspace;
  }
  const pickMain = pickFolderBtn.querySelector('.btn-main-label');
  if (pickMain) pickMain.innerText = '➕ 新建项目';
  const pickSub = pickFolderBtn.querySelector('.btn-sub-label');
  if (pickSub) pickSub.innerText = '选择本地目录或新建文件夹';

  if (treeSearchInput) {
    treeSearchInput.value = '';
    treeSearchInput.focus();
  }
  renderDrawerContent('');
  requestWorkspacesTree();
}

function closeDrawer() {
  drawerModal.classList.add('hidden');
}

btnOpenProjects.addEventListener('click', () => openDrawer('projects'));
btnOpenTasks.addEventListener('click', () => openDrawer('tasks'));
if (projectsDrawerBtn) {
  projectsDrawerBtn.addEventListener('click', () => openDrawer('projects'));
}
closeDrawerBtn.addEventListener('click', closeDrawer);

// 点击抽屉外部遮罩区域自动收起/关闭
drawerModal.addEventListener('click', (e) => {
  if (e.target === drawerModal) {
    closeDrawer();
  }
});

// 按 ESC 键自动收起抽屉
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !drawerModal.classList.contains('hidden')) {
    closeDrawer();
  }
});

// Search / Filter Input
if (treeSearchInput) {
  treeSearchInput.addEventListener('input', () => {
    renderDrawerContent(treeSearchInput.value);
  });
}

// Open Workspace Button (Native Windows Explorer Dialog)
pickFolderBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert('本地守护进程 (Daemon) 尚未连接，请先启动 start-daemon.bat！');
    return;
  }
  const pickMain = pickFolderBtn.querySelector('.btn-main-label');
  if (pickMain) pickMain.innerText = '请在系统窗口选择...';
  const pickSub = pickFolderBtn.querySelector('.btn-sub-label');
  if (pickSub) pickSub.innerText = '正在等待系统选择文件夹...';
  ws.send(JSON.stringify({ type: 'PICK_DIRECTORY' }));
});

addWsBtn.addEventListener('click', () => {
  const targetPath = newWsInput.value.trim();
  if (!targetPath) return;
  if (!recentWorkspaces.some(p => pathEquals(p, targetPath))) {
    recentWorkspaces.unshift(targetPath);
    chrome.storage.local.set({ recent_workspaces: recentWorkspaces });
  }
  switchToWorkspace(targetPath);
  newWsInput.value = '';
  closeDrawer();
});

function requestWorkspacesTree() {
  if (currentWorkspace && currentWorkspace !== '未连接' && !recentWorkspaces.some(p => pathEquals(p, currentWorkspace))) {
    recentWorkspaces.unshift(currentWorkspace);
    chrome.storage.local.set({ recent_workspaces: recentWorkspaces });
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'GET_WORKSPACES_TREE',
      workspaces: recentWorkspaces.filter(p => p && p !== '未连接')
    }));
  } else {
    renderDrawerContent(treeSearchInput ? treeSearchInput.value : '');
  }
}

function renderDrawerContent(filterQuery = '') {
  renderCascadingProjectsAndTasks(filterQuery);
}

// Render Left Cascading Projects & Tasks Selection (分级联动选择)
function renderCascadingProjectsAndTasks(filterQuery = '') {
  if (!cascadeProjectsList || !cascadeTasksList) return;
  cascadeProjectsList.innerHTML = '';
  cascadeTasksList.innerHTML = '';

  const q = (filterQuery || '').trim().toLowerCase();

  // 1. Gather all project models
  let list = projectsTreeData;
  if (!list || list.length === 0) {
    list = recentWorkspaces.filter(p => p && p !== '未连接').map(p => ({
      path: p,
      name: getDirBaseName(p),
      active: pathEquals(p, currentWorkspace),
      sessions: pathEquals(p, currentWorkspace) ? projectSessions : {}
    }));
  }

  // Ensure current active workspace is included
  if (currentWorkspace && currentWorkspace !== '未连接' && !list.some(p => pathEquals(p.path, currentWorkspace))) {
    list.unshift({
      path: currentWorkspace,
      name: getDirBaseName(currentWorkspace),
      active: true,
      sessions: projectSessions
    });
  }

  // Ensure selectedDrawerProjectPath is valid
  if (!selectedDrawerProjectPath || !list.some(p => pathEquals(p.path, selectedDrawerProjectPath))) {
    selectedDrawerProjectPath = (currentWorkspace && currentWorkspace !== '未连接') ? currentWorkspace : (list[0] ? list[0].path : null);
  }

  // Filter projects if query exists
  let visibleProjects = list;
  if (q) {
    visibleProjects = list.filter(p => {
      const pNameMatches = p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q);
      const sessionsObj = pathEquals(p.path, currentWorkspace) ? projectSessions : (p.sessions || {});
      const sessionList = Object.values(sessionsObj);
      const sessionMatches = sessionList.some(s => (s.title || '').toLowerCase().includes(q));
      return pNameMatches || sessionMatches;
    });
  }

  if (projectsCount) {
    projectsCount.innerText = visibleProjects.length;
  }

  // If selected project is filtered out, select first visible
  if (visibleProjects.length > 0 && !visibleProjects.some(p => pathEquals(p.path, selectedDrawerProjectPath))) {
    selectedDrawerProjectPath = visibleProjects[0].path;
  }

  // Render Column 1: Projects List
  if (visibleProjects.length === 0) {
    const emptyP = document.createElement('div');
    emptyP.className = 'cascade-task-empty';
    emptyP.innerText = q ? '未找到匹配项目' : '暂无项目';
    cascadeProjectsList.appendChild(emptyP);
  } else {
    visibleProjects.forEach(p => {
      const isSelected = pathEquals(p.path, selectedDrawerProjectPath);
      const isCurrentWs = pathEquals(p.path, currentWorkspace);
      const sessionsObj = isCurrentWs ? projectSessions : (p.sessions || {});
      const sessionCount = Object.keys(sessionsObj).length;

      const pItem = document.createElement('div');
      pItem.className = 'cascade-project-item' + (isSelected ? ' selected' : '');
      pItem.innerHTML = `
        <span class="p-icon">📁</span>
        <span class="p-name" title="${escapeHtml(p.path)}">${escapeHtml(p.name)}</span>
        ${isCurrentWs ? '<span class="p-badge-curr">当前</span>' : ''}
        <span class="p-meta">(${sessionCount})</span>
        <button class="p-btn-add-conv" title="在该项目下新建对话 (New Conversation in Project)">+</button>
      `;

      pItem.addEventListener('click', (e) => {
        if (e.target.closest('.p-btn-add-conv')) {
          e.stopPropagation();
          createNewSessionInWorkspace(p.path);
          return;
        }
        selectedDrawerProjectPath = p.path;
        renderCascadingProjectsAndTasks(treeSearchInput ? treeSearchInput.value : '');
      });

      pItem.addEventListener('dblclick', () => {
        if (!pathEquals(p.path, currentWorkspace)) {
          switchToWorkspace(p.path);
          closeDrawer();
        }
      });

      cascadeProjectsList.appendChild(pItem);
    });
  }

  // Render Column 2: Tasks of selectedDrawerProjectPath
  const targetProject = list.find(p => pathEquals(p.path, selectedDrawerProjectPath));
  const targetName = targetProject ? targetProject.name : getDirBaseName(selectedDrawerProjectPath || '未选项目');
  
  if (selectedProjectTitle) {
    selectedProjectTitle.innerText = `💬 ${targetName}`;
  }

  // "进入该项目" switch button in header
  if (btnSwitchToProject) {
    if (selectedDrawerProjectPath && !pathEquals(selectedDrawerProjectPath, currentWorkspace)) {
      btnSwitchToProject.classList.remove('hidden');
      btnSwitchToProject.onclick = () => {
        switchToWorkspace(selectedDrawerProjectPath);
        closeDrawer();
      };
    } else {
      btnSwitchToProject.classList.add('hidden');
    }
  }

  if (!selectedDrawerProjectPath) {
    const noSel = document.createElement('div');
    noSel.className = 'cascade-task-empty';
    noSel.innerText = '请选择左侧项目';
    cascadeTasksList.appendChild(noSel);
    if (tasksCount) tasksCount.innerText = '0';
    return;
  }

  const isTargetCurrent = pathEquals(selectedDrawerProjectPath, currentWorkspace);
  const targetSessionsObj = isTargetCurrent ? projectSessions : ((targetProject && targetProject.sessions) || {});
  let targetSessionList = Object.values(targetSessionsObj).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (q) {
    targetSessionList = targetSessionList.filter(s => (s.title || '').toLowerCase().includes(q));
  }

  if (tasksCount) {
    tasksCount.innerText = targetSessionList.length;
  }

  if (targetSessionList.length === 0) {
    const emptyTask = document.createElement('div');
    emptyTask.className = 'cascade-task-empty';
    emptyTask.innerHTML = `
      <span>${q ? '未找到匹配的任务对话' : '此项目暂无历史任务对话'}</span>
    `;
    cascadeTasksList.appendChild(emptyTask);
  } else {
    targetSessionList.forEach(sess => {
      const isCurrentSession = isTargetCurrent && sess.id === currentSessionId;
      const tItem = document.createElement('div');
      tItem.className = 'cascade-task-item' + (isCurrentSession ? ' active' : '');
      const relTime = formatRelativeTime(sess.updatedAt);

      tItem.innerHTML = `
        <span class="task-dot">●</span>
        <span class="task-title" title="${escapeHtml(sess.title || '无标题任务')}">${escapeHtml(sess.title || '无标题任务')}</span>
        <span class="task-time">${escapeHtml(relTime)}</span>
        <button class="task-del-btn" title="删除此任务">🗑️</button>
      `;

      tItem.addEventListener('click', (e) => {
        if (e.target.closest('.task-del-btn')) {
          e.stopPropagation();
          deleteSessionFromProject(selectedDrawerProjectPath, sess.id, sess.title);
          return;
        }
        // Switch to this session and workspace, and close drawer!
        selectProjectSession(selectedDrawerProjectPath, sess.id);
        closeDrawer();
      });

      cascadeTasksList.appendChild(tItem);
    });
  }

  // Add a quick "+ 在此项目新建对话" button at the bottom of the tasks column
  const btnNewTask = document.createElement('div');
  btnNewTask.className = 'cascade-btn-new-task';
  btnNewTask.innerHTML = `
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
    <span>在此项目新建对话</span>
  `;
  btnNewTask.addEventListener('click', () => {
    createNewSessionInWorkspace(selectedDrawerProjectPath);
  });
  cascadeTasksList.appendChild(btnNewTask);
}

// Select a session under a project
function selectProjectSession(wsPath, targetSessionId) {
  if (!pathEquals(wsPath, currentWorkspace)) {
    switchToWorkspace(wsPath, targetSessionId);
    return;
  }
  switchSession(targetSessionId);
}

// Remove project from recent list
function removeProjectFromRecent(wsPath) {
  if (pathEquals(wsPath, currentWorkspace)) {
    alert('无法移除当前正在使用的工作区。请先切换到其他工作区。');
    return;
  }
  if (!confirm(`确定从列表中移除【${getDirBaseName(wsPath)}】吗？\n(提示：本地文件与会话数据将保留在磁盘)`)) return;
  recentWorkspaces = recentWorkspaces.filter(p => !pathEquals(p, wsPath));
  chrome.storage.local.set({ recent_workspaces: recentWorkspaces });
  requestWorkspacesTree();
}

// Delete session from project disk
function deleteSessionFromProject(wsPath, sessionId, title) {
  if (!confirm(`确定删除任务对话【${title || sessionId}】吗？`)) return;
  const isCurrentWs = pathEquals(wsPath, currentWorkspace);

  if (isCurrentWs) {
    delete projectSessions[sessionId];
    if (currentSessionId === sessionId) {
      const remainingIds = Object.keys(projectSessions);
      if (remainingIds.length > 0) {
        currentSessionId = remainingIds[0];
        renderSessionChat(currentSessionId);
      } else {
        createNewSessionInWorkspace(currentWorkspace);
      }
    }
  }

  if (ws) {
    ws.send(JSON.stringify({
      type: 'DELETE_SESSION',
      workspace: wsPath,
      id: sessionId
    }));
    requestWorkspacesTree();
  }
}

// Switch workspace
function switchToWorkspace(newPath, targetSessionId = null) {
  if (!newPath) return;
  saveCurrentSession();

  if (targetSessionId) {
    currentSessionId = targetSessionId;
    chrome.storage.local.set({ active_session_id: targetSessionId });
  } else {
    currentSessionId = null;
  }

  if (ws) {
    ws.send(JSON.stringify({ type: 'SET_WORKSPACE', path: newPath }));
  }
  closeDrawer();
}

// Switching Sessions with strict clean transition
function switchSession(targetId) {
  if (!targetId || !projectSessions[targetId]) return;
  if (targetId === currentSessionId) {
    closeDrawer();
    return;
  }

  // 1. Freeze and save outgoing session
  saveCurrentSession();

  // 2. Clear DOM immediately to prevent any visual or state bleed
  chatMessages.innerHTML = '';
  currentTurnAssistantBubble = null;

  // 3. Set new active session id and remember it
  currentSessionId = targetId;
  chrome.storage.local.set({ active_session_id: targetId });
  const targetSess = projectSessions[targetId];

  // 4. Navigate Gemini Web tab to this session's bound URL
  if (targetSess && targetSess.geminiUrl) {
    console.log('[Sidepanel] Switching Gemini web tab to:', targetSess.geminiUrl);
    chrome.runtime.sendMessage({
      type: 'NAVIGATE_GEMINI_URL',
      url: targetSess.geminiUrl
    });
  }

  // 5. Render clean target session chat
  renderSessionChat(targetId);
  closeDrawer();
}

// Create New Session in target workspace
function createNewSessionInWorkspace(wsPath = currentWorkspace) {
  const isCurrentWs = pathEquals(wsPath, currentWorkspace);
  const count = (isCurrentWs ? Object.keys(projectSessions).length : 0) + 1;
  const title = prompt('请输入新任务的主题：', '新任务 ' + count);
  if (!title) return;

  if (!isCurrentWs) {
    switchToWorkspace(wsPath);
  }

  saveCurrentSession();
  chatMessages.innerHTML = '';
  currentTurnAssistantBubble = null;

  const newId = 'sess_' + Date.now();
  projectSessions[newId] = {
    id: newId,
    title: title.trim(),
    workspace: wsPath,
    geminiUrl: 'https://gemini.google.com/app',
    updatedAt: Date.now(),
    html: ''
  };

  currentSessionId = newId;
  chrome.storage.local.set({ active_session_id: newId });
  saveSessionById(newId);

  chrome.runtime.sendMessage({ type: 'RESET_GEMINI_NEW_CHAT' });
  renderSessionChat(newId);
  closeDrawer();

  if (ws) {
    requestWorkspacesTree();
  }
}

newSessionBtn.addEventListener('click', () => createNewSessionInWorkspace(currentWorkspace));
if (drawerNewSessionBtn) {
  drawerNewSessionBtn.addEventListener('click', () => createNewSessionInWorkspace(currentWorkspace));
}

let pendingInitAfterBundle = false;

initProjectBtn.addEventListener('click', () => {
  if (cachedContext) {
    executeProjectInit();
  } else {
    initProjectBtn.innerText = '⏳ 正在打包全库...';
    pendingInitAfterBundle = true;
    if (ws) ws.send(JSON.stringify({ type: 'GET_CONTEXT' }));
  }
});

function executeProjectInit() {
  initProjectBtn.innerText = '🧠 建立项目认知';
  const initPrompt = [
    '【代码库初始化认知】:',
    '请作为资深全栈架构师，阅读我通过 Repomix 打包的本地成熟工程上下文。',
    '请简明扼要概述：',
    '1. 技术栈与核心业务结构；',
    '2. 声明准备就绪，后续修改代码严格使用 FILE: <path> SEARCH/REPLACE 格式输出。',
    '',
    cachedContext
  ].join('\n');

  dispatchPromptToGemini(initPrompt, '🧠 正在初始化并建立当前代码库的全局认知...');
}

// Daemon Connection
function connectDaemon() {
  ws = new WebSocket('ws://127.0.0.1:3456');

  ws.onopen = () => {
    daemonDot.className = 'pulse-dot online';
    daemonStatus.innerText = '在线';
    ws.send(JSON.stringify({ type: 'GET_CONTEXT' }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleDaemonMessage(data);
    } catch (e) {
      console.error('Invalid message from daemon', e);
    }
  };

  ws.onclose = () => {
    daemonDot.className = 'pulse-dot offline';
    daemonStatus.innerText = '离线';
    setTimeout(connectDaemon, 3000);
  };

  ws.onerror = () => ws.close();
}

function handleDaemonMessage(data) {
  switch (data.type) {
    case 'CONNECTED':
      currentWorkspace = data.workspace;
      activeWorkspaceName.innerText = getDirBaseName(currentWorkspace);
      activeWorkspaceName.title = currentWorkspace;
      
      if (data.skills) {
        availableSkills = data.skills;
        console.log(`[Sidepanel] Loaded ${availableSkills.length} local skills`);
      }

      if (data.sessions && Object.keys(data.sessions).length > 0) {
        projectSessions = data.sessions;
        const sortedKeys = Object.keys(projectSessions).sort((a, b) => {
          return (projectSessions[b].updatedAt || 0) - (projectSessions[a].updatedAt || 0);
        });
        if (!currentSessionId || !projectSessions[currentSessionId]) {
          currentSessionId = sortedKeys[0];
        }
        renderSessionChat(currentSessionId);
      }

      requestWorkspacesTree();
      break;

    case 'WORKSPACES_TREE':
      if (data.tree) {
        projectsTreeData = data.tree;
        data.tree.forEach(p => {
          if (p.path && p.path !== '未连接' && !recentWorkspaces.some(w => pathEquals(w, p.path))) {
            recentWorkspaces.push(p.path);
          }
        });
        chrome.storage.local.set({ recent_workspaces: recentWorkspaces });
        renderDrawerContent(treeSearchInput ? treeSearchInput.value : '');
      }
      break;

    case 'SKILLS_LIST':
      if (data.skills) {
        availableSkills = data.skills;
      }
      break;

    case 'DIRECTORY_PICKED':
      const pickMain = pickFolderBtn.querySelector('.btn-main-label');
      if (pickMain) pickMain.innerText = '➕ 新建项目';
      const pickSub = pickFolderBtn.querySelector('.btn-sub-label');
      if (pickSub) pickSub.innerText = '选择本地目录或新建文件夹';

      if (data.success && data.path) {
        if (!recentWorkspaces.some(p => pathEquals(p, data.path))) {
          recentWorkspaces.unshift(data.path);
          chrome.storage.local.set({ recent_workspaces: recentWorkspaces });
        }
        switchToWorkspace(data.path);
        closeDrawer();
      }
      break;

    case 'WORKSPACE_UPDATED':
      if (data.success) {
        currentWorkspace = data.workspace;
        activeWorkspaceName.innerText = getDirBaseName(currentWorkspace);
        activeWorkspaceName.title = currentWorkspace;
        cachedContext = null;
        
        if (!recentWorkspaces.some(p => pathEquals(p, data.workspace))) {
          recentWorkspaces.unshift(data.workspace);
          chrome.storage.local.set({ recent_workspaces: recentWorkspaces });
        }

        if (data.sessions && Object.keys(data.sessions).length > 0) {
          projectSessions = data.sessions;
          const sortedKeys = Object.keys(projectSessions).sort((a, b) => {
            return (projectSessions[b].updatedAt || 0) - (projectSessions[a].updatedAt || 0);
          });
          if (!currentSessionId || !projectSessions[currentSessionId]) {
            currentSessionId = sortedKeys[0];
          }
          chrome.storage.local.set({ active_session_id: currentSessionId });
          renderSessionChat(currentSessionId);
        }

        ws.send(JSON.stringify({ type: 'GET_CONTEXT' }));
        requestWorkspacesTree();
      } else {
        alert('切换目录失败：' + data.error);
      }
      break;

    case 'SESSION_DELETED':
      requestWorkspacesTree();
      break;

    case 'CONTEXT_RESULT':
      if (data.success) {
        cachedContext = data.content;
        if (pendingInitAfterBundle) {
          pendingInitAfterBundle = false;
          executeProjectInit();
        }
      }
      break;

    case 'DIFF_APPLIED':
      handleDiffAppliedResponse(data.results);
      saveCurrentSession();
      break;

    case 'COMMAND_STARTED':
      createOrResetTerminal(data.command);
      break;

    case 'COMMAND_OUTPUT':
      appendTerminalOutput(data.data, data.stream);
      break;

    case 'COMMAND_EXIT':
      finishTerminal(data.code);
      saveCurrentSession();
      break;
  }
}

// Streaming handler
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STREAM_CHUNK_FROM_GEMINI') {
    if (!currentTurnAssistantBubble) {
      currentTurnAssistantBubble = createMessageElement('assistant');
      chatMessages.appendChild(currentTurnAssistantBubble);
    }

    if (msg.currentUrl && projectSessions[currentSessionId]) {
      projectSessions[currentSessionId].geminiUrl = msg.currentUrl;
    }

    renderBubbleContent(currentTurnAssistantBubble, msg.text, msg.codeBlocks || []);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (msg.isDone) {
      sendBtn.disabled = false;
      saveCurrentSession();

      const autoApplyCheckbox = document.getElementById('auto-apply');
      if (autoApplyCheckbox && autoApplyCheckbox.checked) {
        triggerAutoApply();
      }
    }
  }
});

function renderBubbleContent(container, text, codeBlocks) {
  container.innerHTML = '';
  if (!text) return;

  const cards = [];

  function isValidFilePath(p) {
    if (!p) return false;
    const trimmed = p.trim();
    if (trimmed.includes('<') || trimmed.includes('>') || trimmed.includes(' ') || trimmed.includes('：')) return false;
    if (['path', 'filename', 'filepath', 'some_file', 'your_file'].includes(trimmed.toLowerCase())) return false;
    if (!/^[\w\-\.\/\\@]+$/.test(trimmed)) return false;
    return trimmed.length >= 2 && trimmed.includes('.');
  }

  // 1. Extract FILE_NEW blocks
  const fileNewRegex = /(?:^|\n)(?:FILE_NEW|FILE_CREATE):\s*([^\r\n]+)\s*\n([\s\S]*?)(?=(?:\n(?:FILE_NEW|FILE_CREATE|FILE):|运行此脚本|终端命令|$))/g;
  let fnMatch;
  while ((fnMatch = fileNewRegex.exec(text)) !== null) {
    const rawFileName = fnMatch[1].trim();
    if (!isValidFilePath(rawFileName)) continue;

    let rawCode = fnMatch[2].trim();
    let cleanCode = rawCode
      .replace(/^```[a-zA-Z]*\n?/, '')
      .replace(/\n?```$/, '')
      .replace(/^(?:javascript|js|typescript|ts|python|py|markdown|md|json|html|css|yaml|yml|sh|bash)\s*\n?/i, '')
      .trim();

    if (!cleanCode) continue;

    const patchText = 'FILE_NEW: ' + rawFileName + '\n```\n' + cleanCode + '\n```';
    cards.push({
      type: 'new',
      fileName: rawFileName,
      patchText: patchText,
      fullMatch: fnMatch[0],
      code: cleanCode
    });
  }

  // 2. Extract FILE diff blocks (Tolerant to 2~8 brackets, optional SEARCH/REPLACE keywords, optional code fences)
  const diffRegex = /(?:^|\n)FILE:\s*([^\r\n]+)[\s\S]*?<={0,1}<{2,8}\s*(?:SEARCH)?\r?\n([\s\S]*?)\r?\n={3,8}\r?\n([\s\S]*?)\r?\n>{3,8}(?:\s*REPLACE)?/gi;
  let diffMatch;
  while ((diffMatch = diffRegex.exec(text)) !== null) {
    const rawFileName = diffMatch[1].trim();
    if (!isValidFilePath(rawFileName)) continue;

    let searchContent = diffMatch[2];
    let replaceContent = diffMatch[3];

    // Clean any markdown code fences if wrapped inside
    searchContent = searchContent.replace(/^```[\w]*\r?\n/, '').replace(/\r?\n```$/, '');
    replaceContent = replaceContent.replace(/^```[\w]*\r?\n/, '').replace(/\r?\n```$/, '');

    const standardPatch = `FILE: ${rawFileName}\n<<<<<<< SEARCH\n${searchContent}\n=======\n${replaceContent}\n>>>>>>> REPLACE`;

    cards.push({
      type: 'diff',
      fileName: rawFileName,
      patchText: standardPatch,
      fullMatch: diffMatch[0],
      diff: standardPatch
    });
  }

  // 3. Extract runnable terminal commands
  const detectedCommands = [];
  for (const block of codeBlocks) {
    extractLinesToCommands(block, detectedCommands);
  }
  extractLinesToCommands(text, detectedCommands);
  const uniqueCmds = [...new Set(detectedCommands)];

  // 4. Clean conversational text
  let displayText = text;
  for (const card of cards) {
    displayText = displayText.replace(card.fullMatch, '').trim();
  }

  // Always display natural language explanation if present
  if (displayText) {
    const textEl = document.createElement('div');
    textEl.className = 'bubble-text';
    textEl.style.whiteSpace = 'pre-wrap';
    textEl.style.lineHeight = '1.5';
    textEl.innerText = displayText;
    container.appendChild(textEl);
  }

  // 5. Render diff & new-file cards
  for (const card of cards) {
    const cardEl = document.createElement('div');
    cardEl.className = 'diff-card';
    cardEl.setAttribute('data-patch', card.patchText);
    cardEl.setAttribute('data-file', card.fileName);

    if (card.type === 'new') {
      cardEl.innerHTML = `
        <div class="diff-header">
          <span>📄 <b>${escapeHtml(card.fileName)}</b></span>
          <span class="badge-tag">CREATE</span>
        </div>
        <div class="diff-content">${escapeHtml(card.code)}</div>
        <div class="diff-actions">
          <button class="action-btn apply-btn bound">⚡ 一键创建并写入 (Accept)</button>
        </div>
      `;
    } else {
      cardEl.innerHTML = `
        <div class="diff-header">
          <span>📝 <b>${escapeHtml(card.fileName)}</b></span>
          <span class="badge-tag">PATCH</span>
        </div>
        <div class="diff-content">${escapeHtml(card.diff)}</div>
        <div class="diff-actions">
          <button class="action-btn apply-btn bound">⚡ 应用 Diff 改动 (Accept)</button>
        </div>
      `;
    }

    const btn = cardEl.querySelector('.apply-btn');
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.innerText = '正在写入...';
      ws.send(JSON.stringify({ type: 'APPLY_DIFF', patch: card.patchText }));
      window.lastClickedApplyBtn = btn;
    });

    container.appendChild(cardEl);
  }

  // 6. Render runnable command buttons
  for (const cmd of uniqueCmds) {
    const bar = document.createElement('div');
    bar.className = 'diff-actions';
    bar.style.margin = '8px 0';
    bar.innerHTML = `<button class="action-btn command-btn bound" data-cmd="${escapeHtml(cmd)}">💻 运行终端: <b>${escapeHtml(cmd)}</b></button>`;
    const btn = bar.querySelector('button');
    btn.addEventListener('click', () => {
      btn.disabled = true;
      ws.send(JSON.stringify({ type: 'RUN_COMMAND', command: cmd }));
    });
    container.appendChild(bar);
  }
}

function triggerAutoApply() {
  const container = currentTurnAssistantBubble || chatMessages;
  const unappliedBtns = container.querySelectorAll('.diff-card .apply-btn:not([disabled]):not(.success)');
  if (unappliedBtns.length > 0) {
    console.log(`[Sidepanel] Auto-applying ${unappliedBtns.length} code diffs/files to disk...`);
    unappliedBtns.forEach((btn, idx) => {
      setTimeout(() => {
        if (!btn.disabled && !btn.classList.contains('success')) {
          btn.click();
        }
      }, idx * 180);
    });
  }
}

function extractLinesToCommands(raw, list) {
  if (!raw) return;
  const lines = raw.split('\n')
    .map(l => l.trim())
    .filter(l => l && !['bash', 'sh', 'cmd', 'powershell', 'javascript'].includes(l.toLowerCase()));
  for (const line of lines) {
    if (line.startsWith('node ') || line.startsWith('npm ') || line.startsWith('npx ') || line.startsWith('git ') || line.startsWith('python ')) {
      if (!line.includes('<') && !line.includes('>') && !line.includes('...')) {
        list.push(line);
      }
    }
  }
}

function handleDiffAppliedResponse(results) {
  if (!results || results.length === 0) return;
  for (const item of results) {
    const matchingCards = document.querySelectorAll(`.diff-card[data-file="${escapeHtml(item.file)}"]`);
    matchingCards.forEach(card => {
      const btn = card.querySelector('.apply-btn');
      if (btn) {
        btn.disabled = true;
        if (item.success) {
          btn.className = 'action-btn success bound';
          btn.innerText = '✅ 已成功自动落盘 (' + (item.action || 'OK') + ')';
        } else {
          btn.className = 'action-btn danger bound';
          btn.innerText = '❌ 落盘失败: ' + item.error;
        }
      }
    });
  }

  if (window.lastClickedApplyBtn && !window.lastClickedApplyBtn.classList.contains('success')) {
    const item = results[0];
    if (item.success) {
      window.lastClickedApplyBtn.className = 'action-btn success bound';
      window.lastClickedApplyBtn.innerText = '✅ 已成功落盘 (' + (item.action || 'OK') + ')';
    } else {
      window.lastClickedApplyBtn.innerText = '❌ 失败: ' + item.error;
    }
  }
}

let currentTermBody = null;
let currentTermStatus = null;

function createOrResetTerminal(cmd) {
  let termWin = document.getElementById('active-terminal-win');
  if (termWin) termWin.remove();

  termWin = document.createElement('div');
  termWin.id = 'active-terminal-win';
  termWin.className = 'terminal-window';
  termWin.innerHTML = `
    <div class="terminal-titlebar">
      <span>🖥️ 本地终端: <span class="term-cmd">${escapeHtml(cmd)}</span></span>
      <span class="term-status" style="color:#e3b341;">运行中...</span>
    </div>
    <div class="terminal-body">> ${escapeHtml(cmd)}\n</div>
  `;

  chatMessages.appendChild(termWin);
  currentTermBody = termWin.querySelector('.terminal-body');
  currentTermStatus = termWin.querySelector('.term-status');
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendTerminalOutput(chunk, stream) {
  if (!currentTermBody) return;
  const span = document.createElement('span');
  if (stream === 'stderr') {
    span.style.color = '#f85149';
  }
  span.innerText = chunk;
  currentTermBody.appendChild(span);
  currentTermBody.scrollTop = currentTermBody.scrollHeight;
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function finishTerminal(code) {
  if (currentTermStatus) {
    if (code === 0) {
      currentTermStatus.style.color = '#3fb950';
      currentTermStatus.innerText = '已完成 (Exit 0)';
    } else {
      currentTermStatus.style.color = '#f85149';
      currentTermStatus.innerText = '异常退出 (' + code + ')';
    }
  }
}

function createMessageElement(type) {
  const el = document.createElement('div');
  el.className = 'message ' + type + '-msg';
  return el;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getDirBaseName(dirPath) {
  if (!dirPath) return '未连接';
  const parts = dirPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || dirPath;
}

function dispatchPromptToGemini(fullPrompt, displayUserText, images = []) {
  const userMsgEl = createMessageElement('user');
  let contentHtml = escapeHtml(displayUserText);
  if (images && images.length > 0) {
    for (const imgUrl of images) {
      contentHtml += `<br><img src="${imgUrl}" class="user-attached-img" onclick="window.open('${imgUrl}')" title="点击查看大图" />`;
    }
  }
  userMsgEl.innerHTML = contentHtml;
  chatMessages.appendChild(userMsgEl);
  saveCurrentSession();

  sendBtn.disabled = true;
  currentTurnAssistantBubble = null;

  const safetyTimeout = setTimeout(() => {
    sendBtn.disabled = false;
  }, 15000);

  chrome.runtime.sendMessage({
    type: 'SEND_TO_GEMINI',
    prompt: fullPrompt,
    images: images
  }, (response) => {
    clearTimeout(safetyTimeout);
    if (!response || !response.success) {
      sendBtn.disabled = false;
      const errEl = createMessageElement('system');
      errEl.innerHTML = '⚠️ <strong>发送失败</strong>：' + (response ? response.error : '未能触达页面');
      chatMessages.appendChild(errEl);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      saveCurrentSession();
    }
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Image attachment event listeners
promptInput.addEventListener('paste', (e) => {
  const items = (e.clipboardData || window.clipboardData)?.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.indexOf('image') !== -1) {
      const file = items[i].getAsFile();
      if (file) {
        readAndAddImage(file);
        e.preventDefault();
      }
    }
  }
});

attachImgBtn.addEventListener('click', () => {
  hiddenFileInput.click();
});

hiddenFileInput.addEventListener('change', (e) => {
  const files = e.target.files;
  if (files) {
    for (let i = 0; i < files.length; i++) {
      readAndAddImage(files[i]);
    }
  }
  hiddenFileInput.value = '';
});

function readAndAddImage(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    pendingImages.push(e.target.result);
    renderImagePreviews();
  };
  reader.readAsDataURL(file);
}

function renderImagePreviews() {
  if (pendingImages.length === 0) {
    imagePreviewContainer.classList.add('hidden');
    imagePreviewContainer.innerHTML = '';
    return;
  }

  imagePreviewContainer.classList.remove('hidden');
  imagePreviewContainer.innerHTML = '';

  pendingImages.forEach((imgData, index) => {
    const item = document.createElement('div');
    item.className = 'image-preview-item';
    item.innerHTML = `
      <img src="${imgData}" alt="preview">
      <span class="image-preview-del" title="移除">&times;</span>
    `;
    item.querySelector('.image-preview-del').addEventListener('click', () => {
      pendingImages.splice(index, 1);
      renderImagePreviews();
    });
    imagePreviewContainer.appendChild(item);
  });
}

// Slash Command Skills Popup
promptInput.addEventListener('input', () => {
  checkSlashCommand();
});

function checkSlashCommand() {
  const val = promptInput.value;
  const match = val.match(/(?:^|\s)\/([a-zA-Z0-9_\-\u4e00-\u9fa5]*)$/);
  if (match && availableSkills.length > 0) {
    const query = match[1].toLowerCase();
    const filtered = availableSkills.filter(s => 
      s.name.toLowerCase().includes(query) || 
      s.id.toLowerCase().includes(query) || 
      (s.desc && s.desc.toLowerCase().includes(query))
    );

    if (filtered.length > 0) {
      renderSkillsPopup(filtered);
      return;
    }
  }
  closeSkillsPopup();
}

function renderSkillsPopup(skills) {
  skillsPopup.innerHTML = '';
  skillsPopup.classList.remove('hidden');
  activeSkillIndex = 0;

  skills.forEach((skill, idx) => {
    const el = document.createElement('div');
    el.className = 'skill-item' + (idx === 0 ? ' active' : '');
    el.innerHTML = `
      <div class="skill-item-header">
        <span class="skill-badge">/${escapeHtml(skill.name)}</span>
        <span class="skill-title">${escapeHtml(skill.id)}</span>
      </div>
      <div class="skill-desc">${escapeHtml(skill.desc)}</div>
    `;
    el.addEventListener('click', () => {
      selectSkill(skill);
    });
    skillsPopup.appendChild(el);
  });
}

function selectSkill(skill) {
  const val = promptInput.value;
  const updated = val.replace(/(?:^|\s)\/([a-zA-Z0-9_\-\u4e00-\u9fa5]*)$/, (m) => {
    return (m.startsWith(' ') ? ' /' : '/') + skill.name + ' ';
  });
  promptInput.value = updated;
  closeSkillsPopup();
  promptInput.focus();
}

function closeSkillsPopup() {
  skillsPopup.classList.add('hidden');
  skillsPopup.innerHTML = '';
}

// 点击技能弹窗及输入框外部时自动收起技能弹窗
document.addEventListener('click', (e) => {
  if (!skillsPopup.classList.contains('hidden')) {
    if (!skillsPopup.contains(e.target) && e.target !== promptInput) {
      closeSkillsPopup();
    }
  }
});

function updateActiveSkillItem(items) {
  items.forEach((it, idx) => {
    if (idx === activeSkillIndex) {
      it.classList.add('active');
      it.scrollIntoView({ block: 'nearest' });
    } else {
      it.classList.remove('active');
    }
  });
}

sendBtn.addEventListener('click', () => {
  closeSkillsPopup();
  const text = promptInput.value.trim();
  const hasImages = pendingImages.length > 0;
  if (!text && !hasImages) return;
  promptInput.value = '';

  const existingUserMessages = chatMessages.querySelectorAll('.user-msg');
  const isFirstTurn = existingUserMessages.length === 0;

  let userDisplayText = text || '【发送了截图/图片】';
  let fullPrompt = text || '请仔细分析所上传的图片并给出处理建议/代码实现。';
  
  // 直接透传 /skillname 原生指令到 Gemini 网页端，不进行任何本地 Prompt 劫持与替换
  const isSlashCmd = text.startsWith('/');

  if (attachContextCheckbox.checked && cachedContext && isFirstTurn) {
    if (isSlashCmd) {
      // 保持 /skillname 位于首行首位，以确保被 Gemini 网页端解析为原生指令
      fullPrompt = [
        text,
        '',
        '---',
        '【系统工作区全量代码上下文 (Repomix XML)】:',
        cachedContext,
        '',
        '【输出规范】: 若需新建文件，请务必以独立行 FILE_NEW: 相对路径 开头并包含代码块；若修改现有代码，以 FILE: 相对路径 及 SEARCH/REPLACE 语法块输出；终端命令用 ```bash 块包裹。'
      ].join('\n');
    } else {
      fullPrompt = [
        '【系统工作区全量代码上下文 (Repomix XML)】:',
        cachedContext,
        '',
        '【用户任务与指令】:',
        fullPrompt,
        '',
        '【输出规范】: 若需新建文件，请务必以独立行 FILE_NEW: 相对路径 开头并包含代码块；若修改现有代码，以 FILE: 相对路径 及 SEARCH/REPLACE 语法块输出；终端命令用 ```bash 块包裹。'
      ].join('\n');
    }
  } else if (!isSlashCmd) {
    // 普通编码任务输出规范（若为 / 开头的技能指令则不追加，由在线技能自身规范接管）
    const isCodingTask = /写|改|创|新建|实现|修复|运行|代码|脚本|文件|add|fix|create|update|generate|make|build/i.test(text);
    if (isCodingTask) {
      fullPrompt = [
        fullPrompt,
        '',
        '(输出提示: 新建文件用独立行 FILE_NEW: 相对路径；修改文件用 FILE: 相对路径 与 SEARCH/REPLACE 块；运行命令用 bash 块)'
      ].join('\n');
    }
  }

  const imagesToSend = [...pendingImages];
  pendingImages = [];
  renderImagePreviews();

  dispatchPromptToGemini(fullPrompt, userDisplayText, imagesToSend);
});

promptInput.addEventListener('keydown', (e) => {
  if (!skillsPopup.classList.contains('hidden')) {
    const items = skillsPopup.querySelectorAll('.skill-item');
    if (items.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeSkillIndex = (activeSkillIndex + 1) % items.length;
        updateActiveSkillItem(items);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeSkillIndex = (activeSkillIndex - 1 + items.length) % items.length;
        updateActiveSkillItem(items);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        items[activeSkillIndex].click();
        return;
      }
      if (e.key === 'Escape') {
        closeSkillsPopup();
        return;
      }
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) {
      sendBtn.click();
    }
  }
});

const autoApplyCheckbox = document.getElementById('auto-apply');
if (autoApplyCheckbox) {
  autoApplyCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ auto_apply: autoApplyCheckbox.checked });
  });
}

chrome.storage.local.get(['recent_workspaces', 'active_session_id', 'auto_apply'], (res) => {
  if (res && res.recent_workspaces) {
    recentWorkspaces = res.recent_workspaces;
  }
  if (res && res.active_session_id) {
    currentSessionId = res.active_session_id;
  }
  if (res && res.auto_apply !== undefined && autoApplyCheckbox) {
    autoApplyCheckbox.checked = res.auto_apply;
  }
  connectDaemon();
});