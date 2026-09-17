const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { exec, spawn, execSync, execFile } = require('child_process');
const Patcher = require('./patcher');
const { getAntigravityProjectsTree } = require('./antigravity-db');

const PORT = 3456;
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.resolve(__dirname, '..');
const patcher = new Patcher(WORKSPACE_DIR);

console.log('==================================================');
console.log('🚀 Gemini-Antigravity Local Daemon Starting...');
console.log('📁 Active Workspace: ' + WORKSPACE_DIR);
console.log('🔌 WebSocket Port: ws://127.0.0.1:' + PORT);
console.log('==================================================');

const wss = new WebSocket.Server({ port: PORT });

// Helper: Ensure and get sessions directory
function getSessionsDir(workspace) {
  const sDir = path.join(workspace, '.gemini-bridge', 'sessions');
  if (!fs.existsSync(sDir)) {
    fs.mkdirSync(sDir, { recursive: true });
  }
  return sDir;
}

function loadAllSessionsFromDisk(workspace) {
  const sDir = getSessionsDir(workspace);
  const sessions = {};
  try {
    const files = fs.readdirSync(sDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = fs.readFileSync(path.join(sDir, file), 'utf8');
          const sess = JSON.parse(content);
          if (sess && sess.id) {
            sessions[sess.id] = sess;
          }
        } catch (e) {
          console.warn('[Daemon] Failed to read session file ' + file, e.message);
        }
      }
    }
  } catch (err) {
    console.warn('[Daemon] Could not list sessions in ' + sDir, err.message);
  }

  if (Object.keys(sessions).length === 0) {
    const defaultId = 'sess_default';
    sessions[defaultId] = {
      id: defaultId,
      title: '主对话 (默认)',
      workspace: workspace,
      geminiUrl: 'https://gemini.google.com/app',
      updatedAt: Date.now(),
      html: ''
    };
    saveSessionToDisk(workspace, sessions[defaultId]);
  }

  return sessions;
}

function saveSessionToDisk(workspace, session) {
  if (!session || !session.id) return;
  const sDir = getSessionsDir(workspace);
  const filePath = path.join(sDir, `${session.id}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[Daemon] Failed to save session to disk:', err.message);
    return false;
  }
}

function deleteSessionFromDisk(workspace, sessionId) {
  if (!sessionId) return false;
  const sDir = getSessionsDir(workspace);
  const filePath = path.join(sDir, `${sessionId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (err) {
    console.error('[Daemon] Failed to delete session from disk:', err.message);
  }
  return false;
}

// Discover local user workspaces from Antigravity and file system
function getDiscoveredWorkspaces() {
  const list = [];
  const seen = new Set();

  function addWs(p) {
    if (!p || typeof p !== 'string') return;
    try {
      const resolved = path.resolve(p);
      const lower = resolved.toLowerCase();
      if (!seen.has(lower) && fs.existsSync(resolved)) {
        seen.add(lower);
        list.push(resolved);
      }
    } catch (e) {}
  }

  // 1. Current active workspace is always first
  if (patcher && patcher.workspaceDir) {
    addWs(patcher.workspaceDir);
  }

  // 2. Discover from Antigravity conversation_summaries.db
  const dbPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'conversation_summaries.db');
  if (fs.existsSync(dbPath)) {
    try {
      const pyCmd = `python -c "import sqlite3, json, urllib.parse, os; conn = sqlite3.connect(os.path.expanduser('~/.gemini/antigravity/conversation_summaries.db')); print(json.dumps([urllib.parse.unquote(u.replace('file:///', '')) for row in conn.execute('SELECT workspace_uris FROM conversation_summaries').fetchall() for u in (json.loads(row[0]) if row[0] else []) if os.path.exists(urllib.parse.unquote(u.replace('file:///', '')))]))"`;
      const output = execSync(pyCmd, { encoding: 'utf8', timeout: 3000 }).trim();
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed)) {
        parsed.forEach(p => addWs(p));
      }
    } catch (e) {
      console.warn('[Daemon] Antigravity db scan note:', e.message);
    }
  }

  return list;
}

// Native OS Folder Picker with Vista-style IFileOpenDialog
let activePickerChild = null;

function runPowershellPicker(callback) {
  const scriptPath = path.join(__dirname, 'picker.ps1');
  const cmd = `powershell -NoProfile -STA -ExecutionPolicy Bypass -File "${scriptPath}"`;
  activePickerChild = exec(cmd, { encoding: 'utf8', windowsHide: false }, (err, stdout, stderr) => {
    activePickerChild = null;
    if (err) {
      console.error('[Daemon] Powershell picker error:', err.message, stderr);
      return callback(err, null);
    }
    const selected = (stdout || '').trim();
    callback(null, selected || null);
  });
}

function openNativeFolderPicker(callback) {
  if (process.platform === 'win32') {
    const exePath = path.join(__dirname, 'picker.exe');
    if (activePickerChild) {
      try { activePickerChild.kill(); } catch (e) {}
      activePickerChild = null;
    }

    if (fs.existsSync(exePath)) {
      activePickerChild = execFile(exePath, ['选择或新建项目文件夹 (New Project)'], { encoding: 'utf8', windowsHide: false }, (err, stdout, stderr) => {
        activePickerChild = null;
        if (err && (err.code === 1 || err.code === 2)) {
          // User clicked Cancel or closed dialog
          return callback(null, null);
        }
        if (err) {
          console.error('[Daemon] Picker error, fallback to powershell:', err.message);
          return runPowershellPicker(callback);
        }
        const selected = (stdout || '').trim();
        callback(null, selected || null);
      });
      return;
    }

    runPowershellPicker(callback);
  } else if (process.platform === 'darwin') {
    exec(`osascript -e 'POSIX path of (choose folder with prompt "Select Project Folder")'`, (err, stdout) => {
      if (err) return callback(err, null);
      callback(null, stdout.trim() || null);
    });
  } else {
    // Linux
    exec(`zenity --file-selection --directory --title="Select Project Folder"`, (err, stdout) => {
      if (err) return callback(err, null);
      callback(null, stdout.trim() || null);
    });
  }
}

// Load Local Skills from ~/.gemini/config/skills/
function loadLocalSkills() {
  const skills = [];
  try {
    const skillsDir = path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'config', 'skills');
    if (fs.existsSync(skillsDir)) {
      const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const d of dirs) {
        const skillFile = path.join(skillsDir, d.name, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          const raw = fs.readFileSync(skillFile, 'utf8');
          const fmM = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          let name = d.name;
          let desc = '';
          let body = raw;
          if (fmM) {
            body = raw.slice(fmM[0].length).trim();
            const lines = fmM[1].split('\n');
            for (const l of lines) {
              if (l.trim().startsWith('name:')) name = l.trim().replace(/^name:\s*/, '').trim();
              if (l.trim().startsWith('description:')) desc = l.trim().replace(/^description:\s*/, '').replace(/^["']|["']$/g, '').trim();
            }
          }
          skills.push({
            id: d.name,
            name: name,
            desc: desc.slice(0, 100),
            instruction: body
          });
        }
      }
    }
  } catch (err) {
    console.error('[Daemon] Error loading skills:', err.message);
  }
  return skills;
}

wss.on('connection', (ws) => {
  console.log('[Daemon] Client connected from Chrome Extension!');

  const initialTree = getAntigravityProjectsTree(patcher.workspaceDir);
  const currentProj = initialTree.find(p => p.active) || initialTree.find(p => p.name === 'Antigravity') || initialTree[0];
  const initialSessions = (currentProj && currentProj.sessions) || loadAllSessionsFromDisk(patcher.workspaceDir);
  const localSkills = loadLocalSkills();

  ws.send(JSON.stringify({
    type: 'CONNECTED',
    workspace: patcher.workspaceDir,
    sessions: initialSessions,
    tree: initialTree,
    skills: localSkills,
    timestamp: Date.now()
  }));

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'PING':
          ws.send(JSON.stringify({ type: 'PONG', time: Date.now() }));
          break;

        case 'GET_SKILLS':
          ws.send(JSON.stringify({ type: 'SKILLS_LIST', skills: loadLocalSkills() }));
          break;

        case 'PICK_DIRECTORY':
          console.log('[Daemon] Launching native Windows FolderBrowserDialog...');
          openNativeFolderPicker((err, chosenPath) => {
            if (err || !chosenPath) {
              console.log('[Daemon] Picker cancelled or empty');
              ws.send(JSON.stringify({
                type: 'DIRECTORY_PICKED',
                success: false,
                cancelled: true
              }));
            } else {
              console.log('[Daemon] User selected folder:', chosenPath);
              ws.send(JSON.stringify({
                type: 'DIRECTORY_PICKED',
                success: true,
                path: chosenPath
              }));
            }
          });
          break;

        case 'SET_WORKSPACE':
          if (data.path && fs.existsSync(data.path)) {
            patcher.workspaceDir = data.path;
            const newSessions = loadAllSessionsFromDisk(data.path);
            ws.send(JSON.stringify({
              type: 'WORKSPACE_UPDATED',
              workspace: data.path,
              sessions: newSessions,
              success: true
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'WORKSPACE_UPDATED',
              success: false,
              error: 'Directory does not exist'
            }));
          }
          break;

        case 'SAVE_SESSION':
          if (data.session) {
            const targetWs = data.workspace || patcher.workspaceDir;
            saveSessionToDisk(targetWs, data.session);
            ws.send(JSON.stringify({
              type: 'SESSION_SAVED',
              workspace: targetWs,
              id: data.session.id,
              success: true
            }));
          }
          break;

        case 'DELETE_SESSION':
          const targetWs = data.workspace || patcher.workspaceDir;
          if (data.id) {
            deleteSessionFromDisk(targetWs, data.id);
            ws.send(JSON.stringify({
              type: 'SESSION_DELETED',
              workspace: targetWs,
              id: data.id,
              success: true
            }));
          }
          break;

        case 'GET_WORKSPACES_TREE':
          const clientList = Array.isArray(data.workspaces) ? data.workspaces : [];
          const tree = getAntigravityProjectsTree(patcher.workspaceDir, clientList);
          ws.send(JSON.stringify({
            type: 'WORKSPACES_TREE',
            workspace: patcher.workspaceDir,
            tree: tree
          }));
          break;

        case 'GET_CONTEXT':
          console.log('[Daemon] Bundling repository with repomix in ' + patcher.workspaceDir);
          exec('npx repomix --stdout --style xml --parsable-style', {
            cwd: patcher.workspaceDir,
            maxBuffer: 1024 * 1024 * 50
          }, (err, stdout, stderr) => {
            if (err) {
              console.warn('[Daemon] repomix fallback to tree scan:', err.message);
              const fallbackContext = getSimpleWorkspaceTree(patcher.workspaceDir);
              ws.send(JSON.stringify({
                type: 'CONTEXT_RESULT',
                success: true,
                isFallback: true,
                content: fallbackContext
              }));
            } else {
              console.log('[Daemon] Repomix bundle generated (' + Math.round(stdout.length / 1024) + ' KB)');
              ws.send(JSON.stringify({
                type: 'CONTEXT_RESULT',
                success: true,
                content: stdout
              }));
            }
          });
          break;

        case 'APPLY_DIFF':
          console.log('[Daemon] Applying code patch (force=' + !!data.force + ')...');
          const results = patcher.applyDiff(data.patch, !!data.force);
          ws.send(JSON.stringify({
            type: 'DIFF_APPLIED',
            results: results
          }));
          break;

        case 'RUN_COMMAND':
          let cmd = data.command;
          console.log('[Daemon] Executing command: ' + cmd);

          const isWin = process.platform === 'win32';
          const finalCmd = isWin ? `chcp 65001 >nul && ${cmd}` : cmd;
          const shellCmd = isWin ? 'cmd.exe' : '/bin/sh';
          const shellArgs = isWin ? ['/c', finalCmd] : ['-c', finalCmd];

          ws.send(JSON.stringify({
            type: 'COMMAND_STARTED',
            command: cmd
          }));

          const child = spawn(shellCmd, shellArgs, {
            cwd: patcher.workspaceDir,
            env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', NODE_OPTIONS: '' })
          });

          child.stdout.on('data', (chunk) => {
            ws.send(JSON.stringify({
              type: 'COMMAND_OUTPUT',
              stream: 'stdout',
              data: chunk.toString('utf8')
            }));
          });

          child.stderr.on('data', (chunk) => {
            ws.send(JSON.stringify({
              type: 'COMMAND_OUTPUT',
              stream: 'stderr',
              data: chunk.toString('utf8')
            }));
          });

          child.on('close', (code) => {
            ws.send(JSON.stringify({
              type: 'COMMAND_EXIT',
              code: code
            }));
          });
          break;

        default:
          console.warn('[Daemon] Unknown message type: ' + data.type);
      }
    } catch (e) {
      console.error('[Daemon] Error processing message:', e.message);
      ws.send(JSON.stringify({
        type: 'ERROR',
        error: e.message
      }));
    }
  });

  ws.on('close', () => {
    console.log('[Daemon] Client disconnected');
  });
});

function getSimpleWorkspaceTree(dir, maxDepth = 3, currentDepth = 0) {
  if (currentDepth > maxDepth) return '';
  let tree = '';
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const f of files) {
      if (['node_modules', '.git', '.gemini-bridge', '.gemini-bridge-backups', 'dist', 'build'].includes(f.name)) continue;
      const indent = '  '.repeat(currentDepth);
      if (f.isDirectory()) {
        tree += indent + '📁 ' + f.name + '/\n';
        tree += getSimpleWorkspaceTree(path.join(dir, f.name), maxDepth, currentDepth + 1);
      } else {
        tree += indent + '📄 ' + f.name + '\n';
      }
    }
  } catch (err) {}
  return tree;
}