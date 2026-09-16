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

  applyDiff(patchText) {
    const results = [];
    const normalizedPatch = this.normalizeLineEndings(patchText);

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

    // 2. Check for SEARCH/REPLACE blocks
    const diffRegex = /FILE:\s*([^\r\n]+)[\s\S]*?<{7}\s*SEARCH\n([\s\S]*?)\n={7}\n([\s\S]*?)\n>{7}/g;
    let diffMatch;
    while ((diffMatch = diffRegex.exec(normalizedPatch)) !== null) {
      const relPath = diffMatch[1].trim();
      const searchBlock = diffMatch[2];
      const replaceBlock = diffMatch[3];
      const fullPath = path.resolve(this.workspaceDir, relPath);

      if (!fs.existsSync(fullPath)) {
        results.push({
          file: relPath,
          action: 'patch',
          success: false,
          error: 'File does not exist on disk'
        });
        continue;
      }

      try {
        let fileContent = this.normalizeLineEndings(fs.readFileSync(fullPath, 'utf8'));
        const normalizedSearch = this.normalizeLineEndings(searchBlock);
        const normalizedReplace = this.normalizeLineEndings(replaceBlock);

        if (!fileContent.includes(normalizedSearch)) {
          // Line by line fuzzy fallback
          const searchLines = normalizedSearch.split('\n').map(l => l.trimEnd());
          const fileLines = fileContent.split('\n');
          let foundIdx = -1;

          for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
            let match = true;
            for (let j = 0; j < searchLines.length; j++) {
              if (fileLines[i + j].trimEnd() !== searchLines[j]) {
                match = false;
                break;
              }
            }
            if (match) {
              foundIdx = i;
              break;
            }
          }

          if (foundIdx !== -1) {
            fileLines.splice(foundIdx, searchLines.length, normalizedReplace);
            this.backupFile(fullPath);
            fs.writeFileSync(fullPath, fileLines.join('\n'), 'utf8');
            results.push({ file: relPath, action: 'patch', success: true, method: 'fuzzy' });
          } else {
            results.push({
              file: relPath,
              action: 'patch',
              success: false,
              error: 'SEARCH block could not be located in file'
            });
          }
        } else {
          this.backupFile(fullPath);
          fileContent = fileContent.replace(normalizedSearch, normalizedReplace);
          fs.writeFileSync(fullPath, fileContent, 'utf8');
          results.push({ file: relPath, action: 'patch', success: true, method: 'exact' });
        }
      } catch (err) {
        results.push({ file: relPath, action: 'patch', success: false, error: err.message });
      }
    }

    return results;
  }
}

module.exports = Patcher;