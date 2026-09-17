(() => {
if (window.__GEMINI_BRIDGE_INITIALIZED__) {
  console.log('[Gemini-Bridge] Content script already initialized in this world');
  return;
}
window.__GEMINI_BRIDGE_INITIALIZED__ = true;

console.log('[Gemini-Bridge] Content script active with SPA navigation support');

let activeObserver = null;
let lastCapturedText = '';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PING') {
    sendResponse({ pong: true, url: window.location.href });
    return true;
  }

  if (request.type === 'INPUT_PROMPT') {
    handleInputPrompt(request.prompt, request.images || [])
      .then(() => sendResponse({ success: true, currentUrl: window.location.href }))
      .catch((err) => {
        console.error('[Gemini-Bridge] Input failed:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  // Trigger real SPA "New Chat" click on Gemini web page
  if (request.type === 'TRIGGER_NEW_CHAT') {
    if (activeObserver) {
      clearInterval(activeObserver);
      activeObserver = null;
    }
    lastCapturedText = '';
    triggerNewChat()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function triggerNewChat() {
  const newChatSelectors = [
    'button[aria-label*="发起新对话"]',
    'button[aria-label*="New chat"]',
    'button[aria-label*="新建对话"]',
    '.new-chat-button',
    'a[href="/app"]',
    'button:has(mat-icon[data-mat-icon-name="add"])'
  ];

  for (const s of newChatSelectors) {
    const el = document.querySelector(s);
    if (el) {
      el.click();
      console.log('[Gemini-Bridge] Clicked New Chat button!');
      return;
    }
  }

  // Fallback: reload to base url
  window.location.href = 'https://gemini.google.com/app';
}

async function handleInputPrompt(promptText, images = []) {
  const placeholderPill = document.querySelector('button[aria-label*="问问"], button[aria-label*="Ask"], .input-area-placeholder');
  if (placeholderPill) {
    placeholderPill.click();
    await new Promise(r => setTimeout(r, 400));
  }

  let editor = null;
  const editorSelectors = [
    'div.ql-editor[contenteditable="true"]',
    'rich-textarea [contenteditable="true"]',
    '[contenteditable="true"]',
    'textarea'
  ];

  for (let attempt = 0; attempt < 5; attempt++) {
    for (const sel of editorSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        editor = el;
        break;
      }
    }
    if (editor) break;
    const inputArea = document.querySelector('.input-area, .chat-input-container, rich-textarea');
    if (inputArea) inputArea.click();
    await new Promise(r => setTimeout(r, 300));
  }

  if (!editor) throw new Error('未定位到输入框');
  editor.focus();

  // If there are attached images, inject them first
  if (images && images.length > 0) {
    for (let i = 0; i < images.length; i++) {
      try {
        const file = dataURLtoFile(images[i], `pasted_${Date.now()}_${i}.png`);
        const fileInput = document.querySelector('input[type="file"][accept*="image"], input[type="file"]');
        if (fileInput) {
          const dt = new DataTransfer();
          dt.items.add(file);
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          const dt = new DataTransfer();
          dt.items.add(file);
          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt
          });
          editor.dispatchEvent(pasteEvent);
        }
        await new Promise(r => setTimeout(r, 600));
      } catch (imgErr) {
        console.warn('[Gemini-Bridge] Image injection warning:', imgErr);
      }
    }
    await new Promise(r => setTimeout(r, 800));
  }

  if (editor.getAttribute('contenteditable') === 'true' || editor.classList.contains('ql-editor')) {
    editor.innerHTML = '<p>' + escapeHtml(promptText).replace(/\n/g, '<br>') + '</p>';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    editor.value = promptText;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  }

  await new Promise(r => setTimeout(r, 500));

  const sendSelectors = [
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'button.send-button',
    'mat-icon[data-mat-icon-name="send"]',
    '.send-button-container button'
  ];

  let sendBtn = null;
  for (const s of sendSelectors) {
    const el = document.querySelector(s);
    if (el) {
      sendBtn = el.closest('button') || el;
      if (!sendBtn.disabled) break;
    }
  }

  if (sendBtn && !sendBtn.disabled) {
    sendBtn.click();
  } else {
    editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      composed: true
    }));
  }

  startStreamingObserver();
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function dataURLtoFile(dataurl, filename) {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

function checkIsGenerating() {
  // 1. 检查是否存在真实且可见的停止生成按钮
  const stopSelectors = [
    'button[aria-label*="Stop"]',
    'button[aria-label*="停止"]',
    'button[aria-label*="Cancel"]',
    'button[aria-label*="取消"]',
    'button.stop-button',
    '[data-test-id="stop-button"]',
    'mat-icon[data-mat-icon-name="stop"]',
    'mat-icon[data-mat-icon-name="pause"]'
  ];
  for (const s of stopSelectors) {
    const el = document.querySelector(s);
    if (el && el.offsetParent !== null && !el.disabled) {
      return true;
    }
  }

  // 2. 检查发送按钮是否正处于禁用态（Gemini 输出时发送按钮必定禁用或隐藏）
  const sendSelectors = [
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'button.send-button',
    '.send-button-container button'
  ];
  for (const s of sendSelectors) {
    const el = document.querySelector(s);
    if (el && el.offsetParent !== null) {
      if (el.disabled) return true;
    }
  }

  return false;
}

function startStreamingObserver() {
  if (activeObserver) clearInterval(activeObserver);
  lastCapturedText = '';

  let polls = 0;
  let stableCount = 0;

  activeObserver = setInterval(() => {
    polls++;
    const responseElements = document.querySelectorAll(
      '.model-response-text, message-content, [data-test-id="model-response-text"], .response-container, .markdown'
    );
    if (!responseElements || responseElements.length === 0) {
      if (polls > 200) {
        clearInterval(activeObserver);
        activeObserver = null;
      }
      return;
    }

    const latest = responseElements[responseElements.length - 1];
    const isGen = checkIsGenerating();
    
    let text = (latest.innerText || latest.textContent || '').trim();
    
    const codeBlocks = [];
    latest.querySelectorAll('pre, code-block, pre code, .code-block').forEach(codeEl => {
      const codeTxt = (codeEl.innerText || codeEl.textContent || '').trim();
      if (codeTxt) codeBlocks.push(codeTxt);
    });

    if (text && text !== lastCapturedText) {
      lastCapturedText = text;
      stableCount = 0; // 重置稳定计数器（正在输出中，绝不中断）

      chrome.runtime.sendMessage({
        type: 'STREAM_CHUNK_FROM_GEMINI',
        text: text,
        codeBlocks: codeBlocks,
        currentUrl: window.location.href,
        isDone: false
      }, () => { if (chrome.runtime.lastError) {} });
    } else if (text.length > 0) {
      // 文本没有变化，增加静默稳定计数
      stableCount++;
    }

    // 判定完成条件：
    // 1. 发送按钮已恢复可用，且无停止按钮 (isGen === false)
    // 2. 文本连续 3 次轮询（1.2 秒）无任何新增字符变化
    // 3. 至少轮询过 5 次
    // 4. 内容非空
    if (!isGen && stableCount >= 3 && text.length > 0 && polls >= 5) {
      clearInterval(activeObserver);
      activeObserver = null;
      console.log('[Gemini-Bridge] Generation completed cleanly! Total length:', text.length);

      chrome.runtime.sendMessage({
        type: 'STREAM_CHUNK_FROM_GEMINI',
        text: text,
        codeBlocks: codeBlocks,
        currentUrl: window.location.href,
        isDone: true
      }, () => { if (chrome.runtime.lastError) {} });
    }

    // 超时兜底（单次任务超过 15 分钟）
    if (polls > 2250) {
      clearInterval(activeObserver);
      activeObserver = null;
    }
  }, 400);
}

// 全局被动监听：当用户在 Gemini 网页端直接点击或发送消息时，自动感知并同步到侧边栏
let globalObserverTimer = null;
const globalMutationWatcher = new MutationObserver(() => {
  if (globalObserverTimer) return;
  globalObserverTimer = setTimeout(() => {
    globalObserverTimer = null;
    if (checkIsGenerating() && !activeObserver) {
      console.log('[Gemini-Bridge] Detected Gemini generation in progress from web tab, activating observer...');
      startStreamingObserver();
    }
  }, 300);
});

try {
  globalMutationWatcher.observe(document.body, { childList: true, subtree: true });
} catch (e) {
  console.warn('[Gemini-Bridge] Could not start global mutation watcher:', e);
}
})();