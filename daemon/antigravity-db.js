const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

function loadBridgeSessions(workspace) {
  const sDir = path.join(workspace, '.gemini-bridge', 'sessions');
  const sessions = {};
  if (!fs.existsSync(sDir)) return sessions;
  try {
    const files = fs.readdirSync(sDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = fs.readFileSync(path.join(sDir, file), 'utf8');
          const sess = JSON.parse(content);
          if (sess && sess.id && sess.title && sess.title !== '主对话 (默认)') {
            sessions[sess.id] = sess;
          }
        } catch (e) {}
      }
    }
  } catch (err) {}
  return sessions;
}

function norm(p) {
  if (!p) return '';
  try {
    return path.resolve(path.normalize(p)).toLowerCase();
  } catch (e) {
    return (p || '').toLowerCase();
  }
}

function getAntigravityProjectsTree(currentWorkspace, extraWorkspaces = []) {
  const dbPath = path.join(os.homedir(), '.gemini', 'antigravity', 'conversation_summaries.db');

  const pyScript = `
import sqlite3, json, os, sys, urllib.parse
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
db = os.path.expanduser('~/.gemini/antigravity/conversation_summaries.db')
if not os.path.exists(db):
    print("[]")
    sys.exit(0)
conn = sqlite3.connect(db)
rows = conn.execute("SELECT conversation_id, title, workspace_uris, project_id, last_modified_time FROM conversation_summaries ORDER BY last_modified_time DESC").fetchall()

result = []
for r in rows:
    uris = []
    if r[2]:
        try:
            for u in json.loads(r[2]):
                cleaned = urllib.parse.unquote(u.replace('file:///', ''))
                if cleaned:
                    uris.append(os.path.normpath(cleaned))
        except:
            pass
    title = (r[1] or '').strip() or '新对话'
    result.append({
        'id': r[0],
        'title': title,
        'uris': uris,
        'projectId': r[3],
        'updatedAt': r[4]
    })
print(json.dumps(result, ensure_ascii=False))
`;

  let convList = [];
  try {
    const output = execSync('python', {
      input: pyScript,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }),
      timeout: 5000
    });
    convList = JSON.parse(output.trim());
  } catch (err) {
    console.error('[AntigravityDB] Error loading DB:', err.message);
  }

  // 100% Dynamic Project Discovery from SQLite & Filesystem (Zero hardcoding)
  const projectMap = new Map();

  for (const c of convList) {
    const uris = c.uris || [];
    const pid = c.projectId && c.projectId.trim() ? c.projectId : (uris[0] || 'default_project');

    if (!projectMap.has(pid)) {
      projectMap.set(pid, {
        id: pid,
        paths: new Set(),
        conversations: [],
        latestTime: 0
      });
    }

    const pGroup = projectMap.get(pid);
    for (const u of uris) {
      pGroup.paths.add(u);
    }

    let ts = Date.now();
    try {
      ts = new Date(c.updatedAt).getTime();
    } catch (e) {}

    if (ts > pGroup.latestTime) {
      pGroup.latestTime = ts;
    }

    if (c.title) {
      pGroup.conversations.push({
        id: c.id,
        title: c.title,
        updatedAt: ts,
        isAntigravity: true
      });
    }
  }

  // Convert map to dynamic project list
  const dynamicProjects = [];
  for (const [pid, pGroup] of projectMap.entries()) {
    const allPaths = Array.from(pGroup.paths);
    // Find existing paths on disk
    const existingPaths = allPaths.filter(p => {
      try { return fs.existsSync(p); } catch (e) { return false; }
    });

    let canonicalPath = '';
    if (existingPaths.length > 1) {
      // Prioritize named directory over pure numeric folder
      existingPaths.sort((a, b) => {
        const baseA = path.basename(a);
        const baseB = path.basename(b);
        const aIsNum = /^\d+$/.test(baseA);
        const bIsNum = /^\d+$/.test(baseB);
        if (aIsNum && !bIsNum) return 1;
        if (!aIsNum && bIsNum) return -1;
        return b.length - a.length;
      });
      canonicalPath = existingPaths[0];
    } else if (existingPaths.length === 1) {
      canonicalPath = existingPaths[0];
    } else if (allPaths.length > 0) {
      canonicalPath = allPaths[0];
    }

    const name = canonicalPath ? (path.basename(canonicalPath) || canonicalPath) : '未命名项目';

    dynamicProjects.push({
      id: pid,
      name: name,
      path: canonicalPath,
      aliases: allPaths.map(norm),
      conversations: pGroup.conversations,
      latestTime: pGroup.latestTime
    });
  }

  // Incorporate custom workspaces opened via folder picker
  if (Array.isArray(extraWorkspaces)) {
    extraWorkspaces.forEach(ew => {
      if (!ew || ew === '未连接') return;
      const ewNorm = norm(ew);
      const exists = dynamicProjects.some(dp => norm(dp.path) === ewNorm || dp.aliases.includes(ewNorm));
      if (!exists && fs.existsSync(ew)) {
        dynamicProjects.push({
          id: 'custom_' + Buffer.from(ew).toString('hex').slice(0, 16),
          name: path.basename(ew) || ew,
          path: path.resolve(ew),
          aliases: [norm(ew)],
          conversations: [],
          latestTime: Date.now()
        });
      }
    });
  }

  // Ensure current active workspace is included if valid
  if (currentWorkspace && currentWorkspace !== '未连接') {
    const curNorm = norm(currentWorkspace);
    const curExists = dynamicProjects.some(dp => norm(dp.path) === curNorm || dp.aliases.includes(curNorm));
    if (!curExists && fs.existsSync(currentWorkspace)) {
      dynamicProjects.unshift({
        id: 'current_' + Buffer.from(currentWorkspace).toString('hex').slice(0, 16),
        name: path.basename(currentWorkspace) || currentWorkspace,
        path: path.resolve(currentWorkspace),
        aliases: [curNorm],
        conversations: [],
        latestTime: Date.now()
      });
    }
  }

  // Build the final projects tree
  const curNorm = norm(currentWorkspace);
  const tree = dynamicProjects.map(proj => {
    const sessions = {};

    // 1. Antigravity conversations from SQLite DB
    proj.conversations.forEach(c => {
      sessions[c.id] = {
        id: c.id,
        title: c.title,
        workspace: proj.path,
        updatedAt: c.updatedAt,
        isAntigravity: true
      };
    });

    // 2. Local bridge sessions from .gemini-bridge/sessions/
    if (proj.path && fs.existsSync(proj.path)) {
      const bridgeSessions = loadBridgeSessions(proj.path);
      Object.assign(sessions, bridgeSessions);
    }

    const isCurrent = curNorm && (
      norm(proj.path) === curNorm ||
      proj.aliases.includes(curNorm)
    );

    return {
      id: proj.id,
      name: proj.name,
      path: proj.path,
      active: !!isCurrent,
      sessions: sessions,
      latestTime: proj.latestTime
    };
  });

  // Sort: active project first, then by most recent activity
  tree.sort((a, b) => {
    if (a.active) return -1;
    if (b.active) return 1;
    return (b.latestTime || 0) - (a.latestTime || 0);
  });

  return tree;
}

module.exports = { getAntigravityProjectsTree };
