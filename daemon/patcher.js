const fs = require('fs');
const path = require('path');

class Patcher {
  constructor(workspaceDir) {
    this.workspaceDir = workspaceDir;
    this.backupDir = path.join(workspaceDir, '.gemini-bridge-backups');
  }

  ensureBackupDir() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  backupFile(targetFilePath) {
    try {
      this.ensureBackupDir();
      const relative = path.relative(this.workspaceDir, targetFilePath);
      const safeName = relative.replace(/[\\/]/g, '__') + '.' + Date.now() + '.bak';
      const backupPath = path.join(this.backupDir, safeName);
      if (fs.existsSync(targetFilePath)) {
        fs.copyFileSync(targetFilePath, backupPath);
        return backupPath;
      }
    } catch (e) {
      console.error('[Patcher] Backup failed:', e.message);
    }
    return null;
  }

  normalizeLineEndings(str) {
    return (str || '').replace(/\r\n/g, '\n');
  }

  applyDiff(patchText, force = false) {
    const results = [];
    let normalizedPatch = this.normalizeLineEndings(patchText);

    // Clean up any glued code block language headers e.g. ".mdMarkdown#", ".mdMarkdown<<<<", ".jsJavaScript", etc.
    normalizedPatch = normalizedPatch
      .replace(/(\.[\w]{1,10})\s*(?:Markdown|markdown|JSON|json|Python|python|JavaScript|javascript|TypeScript|typescript|html|HTML|css|CSS|bash|sh|yaml|yml)(?=\s*[#<>\r\n])/g, '$1\n')
      .replace(/(\.[\w]{1,10})Markdown(?=[^\w\s])/gi, '$1\n');

    // 1. Check for FILE_NEW: path/to/file
    // Format: FILE_NEW: <path>\n```\n<content>\n```
    const newFileRegex = /(?:FILE_NEW|FILE_CREATE):\s*([^\r\n]+)\s*\n(?:```[\w]*\n)?([\s\S]*?)(?:\n```|$)/g;
    let newMatch;
    while ((newMatch = newFileRegex.exec(normalizedPatch)) !== null) {
      const relPath = newMatch[1].trim();
      let content = newMatch[2].trim();
      // Remove trailing code fence if captured
      content = content.replace(/\n```$/, '').replace(/^```[\w]*\n/, '').trim();
      
      const fullPath = path.resolve(this.workspaceDir, relPath);

      try {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        this.backupFile(fullPath);
        fs.writeFileSync(fullPath, content + '\n', 'utf8');
        console.log(`[Patcher] Successfully wrote ${content.length} bytes to ${relPath}`);
        results.push({ file: relPath, action: 'created', success: true });
      } catch (err) {
        results.push({ file: relPath, action: 'created', success: false, error: err.message });
      }
    }

    // 2. Check for SEARCH/REPLACE blocks (Tolerant to 2~8 brackets, optional SEARCH/REPLACE keywords, optional code fences)
    const diffRegex = /(?:^|\n)FILE:\s*([^\r\n]+)[\s\S]*?<={0,1}<{2,8}\s*(?:SEARCH)?\r?\n([\s\S]*?)\r?\n={3,8}\r?\n([\s\S]*?)\r?\n>{3,8}(?:\s*REPLACE)?/gi;
    let diffMatch;
    while ((diffMatch = diffRegex.exec(normalizedPatch)) !== null) {
      const relPath = diffMatch[1].trim();
      let searchBlock = diffMatch[2];
      let replaceBlock = diffMatch[3];

      // Strip any stray markdown code fences
      searchBlock = searchBlock.replace(/^```[\w]*\r?\n/, '').replace(/\r?\n```$/, '');
      replaceBlock = replaceBlock.replace(/^```[\w]*\r?\n/, '').replace(/\r?\n```$/, '');

      const fullPath = path.resolve(this.workspaceDir, relPath);

      if (!fs.existsSync(fullPath)) {
        // If file does not exist yet on disk, create it with replaceBlock directly!
        try {
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, replaceBlock + '\n', 'utf8');
          console.log(`[Patcher] Target file did not exist, created new file from diff: ${relPath}`);
          results.push({ file: relPath, action: 'created_from_diff', success: true });
        } catch (e) {
          results.push({
            file: relPath,
            action: 'patch',
            success: false,
            error: 'File does not exist and could not be created: ' + e.message
          });
        }
        continue;
      }

      try {
        const fileContent = this.normalizeLineEndings(fs.readFileSync(fullPath, 'utf8'));
        const patchRes = this.smartApplyPatch(fileContent, searchBlock, replaceBlock, force);
        if (patchRes.success) {
          this.backupFile(fullPath);
          fs.writeFileSync(fullPath, patchRes.result + '\n', 'utf8');
          console.log(`[Patcher] Successfully patched ${relPath} via ${patchRes.method}`);
          results.push({ file: relPath, action: 'patch', success: true, method: patchRes.method });
        } else {
          console.warn(`[Patcher] Patch failed for ${relPath}: ${patchRes.error}`);
          results.push({ file: relPath, action: 'patch', success: false, error: patchRes.error });
        }
      } catch (err) {
        results.push({ file: relPath, action: 'patch', success: false, error: err.message });
      }
    }

    return results;
  }

  normalizeHeader(h) {
    return (h || '')
      .replace(/^#+\s*/, '')
      .replace(/^[0-9一二三四五六七八九十]+[\.、\s]*/, '')
      .replace(/[\(（].*?[\)）]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  matchHeaders(h1, h2) {
    const c1 = this.normalizeHeader(h1);
    const c2 = this.normalizeHeader(h2);
    if (!c1 || !c2) return false;
    if (c1 === c2) return true;
    if (c1.includes(c2) || c2.includes(c1)) return true;
    const keywords = ['细摘要', '滚动', '即时状态', '场上状态', '活跃角色', '空间锚点', '大事件', '看板', '人物状态'];
    for (const kw of keywords) {
      if (c1.includes(kw) && c2.includes(kw)) return true;
    }
    return false;
  }

  parseMarkdownSections(text) {
    const lines = text.split('\n');
    const sections = [];
    let currentHeader = null;
    let currentLines = [];

    for (const line of lines) {
      const match = line.match(/^(#{1,4})\s+(.+)/);
      if (match) {
        if (currentHeader) {
          sections.push({ header: currentHeader, lines: currentLines, fullText: [currentHeader, ...currentLines].join('\n') });
        }
        currentHeader = line;
        currentLines = [];
      } else {
        if (currentHeader) {
          currentLines.push(line);
        }
      }
    }
    if (currentHeader) {
      sections.push({ header: currentHeader, lines: currentLines, fullText: [currentHeader, ...currentLines].join('\n') });
    }
    return sections;
  }

  smartApplyPatch(fileContent, searchBlock, replaceBlock, force = false) {
    const normalize = (s) => (s || '').replace(/\r\n/g, '\n');
    const content = normalize(fileContent);
    const search = normalize(searchBlock).trim();
    const replace = normalize(replaceBlock).trim();

    // Tier 1: Exact match
    if (content.includes(search)) {
      return { success: true, method: 'exact', result: content.replace(search, replace) };
    }

    const fileLines = content.split('\n');
    const searchLines = search.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Tier 2: Line-trimmed contiguous match
    if (searchLines.length > 0) {
      for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
        let match = true;
        for (let j = 0; j < searchLines.length; j++) {
          if (fileLines[i + j].trim() !== searchLines[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          const copy = [...fileLines];
          copy.splice(i, searchLines.length, replace);
          return { success: true, method: 'line_trimmed', result: copy.join('\n') };
        }
      }
    }

    // Tier 3: Markdown Table match
    const isTable = (text) => text.includes('|') && /\|(?:\s*[-:]+\s*\|)+/.test(text);
    if (isTable(replace) || isTable(search)) {
      let tableStart = -1;
      let tableEnd = -1;
      for (let i = 0; i < fileLines.length; i++) {
        if (fileLines[i].includes('|') && (i + 1 < fileLines.length) && /\|(?:\s*[-:]+\s*\|)+/.test(fileLines[i + 1])) {
          tableStart = i;
          break;
        }
      }
      if (tableStart !== -1) {
        tableEnd = tableStart;
        while (tableEnd < fileLines.length && fileLines[tableEnd].trim().startsWith('|')) {
          tableEnd++;
        }
        const copy = [...fileLines];
        copy.splice(tableStart, tableEnd - tableStart, replace);
        return { success: true, method: 'markdown_table', result: copy.join('\n') };
      }
    }

    // Tier 4: Semantic Markdown Section match (Multi-section support)
    const replaceSections = this.parseMarkdownSections(replace);
    if (replaceSections.length > 0) {
      const copy = [...fileLines];
      let replacedCount = 0;

      for (const sec of replaceSections) {
        let targetIdx = -1;
        for (let i = 0; i < copy.length; i++) {
          const line = copy[i];
          if (/^#{1,4}\s+/.test(line) && this.matchHeaders(line, sec.header)) {
            targetIdx = i;
            break;
          }
        }

        if (targetIdx !== -1) {
          const headerLevel = (copy[targetIdx].match(/^#+/) || ['#'])[0].length;
          let endIdx = copy.length;
          for (let j = targetIdx + 1; j < copy.length; j++) {
            const nextMatch = copy[j].match(/^(#{1,4})\s+/);
            if (nextMatch && nextMatch[1].length <= headerLevel) {
              endIdx = j;
              break;
            }
          }
          copy.splice(targetIdx, endIdx - targetIdx, sec.fullText.trimEnd());
          replacedCount++;
        }
      }

      if (replacedCount > 0) {
        return { success: true, method: `semantic_sections_${replacedCount}`, result: copy.join('\n') };
      }
    }

    // Tier 5: Fuzzy line overlap (Jaccard / Subsequence match)
    if (searchLines.length >= 2) {
      let bestIdx = -1;
      let bestScore = 0;
      let bestSpan = searchLines.length;

      for (let i = 0; i < fileLines.length; i++) {
        for (let span = Math.max(1, searchLines.length - 2); span <= Math.min(fileLines.length - i, searchLines.length + 3); span++) {
          const windowLines = fileLines.slice(i, i + span).map(l => l.trim()).filter(l => l.length > 0);
          if (windowLines.length === 0) continue;
          
          let matches = 0;
          for (const sLine of searchLines) {
            if (windowLines.some(w => w === sLine || w.includes(sLine) || sLine.includes(w))) {
              matches++;
            }
          }
          const score = matches / Math.max(searchLines.length, windowLines.length);
          if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
            bestSpan = span;
          }
        }
      }

      if (bestScore >= 0.4 && bestIdx !== -1) {
        const copy = [...fileLines];
        copy.splice(bestIdx, bestSpan, replace);
        return { success: true, method: `fuzzy_overlap_${Math.round(bestScore * 100)}%`, result: copy.join('\n') };
      }
    }

    // Tier 6: Force Mode (When user explicitly clicks Force Apply)
    if (force) {
      // 1. If replaceBlock contains top level header (# Header) or target file is short, overwrite entire file
      if (/^#\s+/.test(replace) || fileLines.length <= 40) {
        return { success: true, method: 'force_overwrite', result: replace };
      }

      // 2. Append replaceBlock to the end of the file with clear divider
      const copy = [...fileLines];
      copy.push('\n' + replace);
      return { success: true, method: 'force_append', result: copy.join('\n') };
    }

    return { success: false, error: 'SEARCH block could not be located in file' };
  }
}

module.exports = Patcher;