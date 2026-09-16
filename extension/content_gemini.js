console.log('[Gemini-Bridge] Content script active with SPA navigation support');

let activeObserver = null;
let lastCapturedText = '';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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

function startStreamingObserver() {
  if (activeObserver) clearInterval(activeObserver);
  lastCapturedText = '';

  let polls = 0;
  activeObserver = setInterval(() => {
    polls++;
    const responseElements = document.querySelectorAll('.model-response-text, message-content, [data-test-id="model-response-text"], .response-container');
    if (!responseElements || responseElements.length === 0) {
      if (polls > 150) clearInterval(activeObserver);
      return;
    }

    const latest = responseElements[responseElements.length - 1];
    const isGenerating = !!document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"], .generating, [aria-label*="Cancel"]');
    
    let text = latest.innerText || latest.textContent || '';
    
    const codeBlocks = [];
    latest.querySelectorAll('pre, code-block, pre code').forEach(codeEl => {
      const codeTxt = codeEl.innerText.trim();
      if (codeTxt) codeBlocks.push(codeTxt);
    });

    if (text && text !== lastCapturedText) {
      lastCapturedText = text;
      chrome.runtime.sendMessage({
        type: 'STREAM_CHUNK_FROM_GEMINI',
        text: text,
        codeBlocks: codeBlocks,
        currentUrl: window.location.href,
        isDone: !isGenerating
      }, () => { if (chrome.runtime.lastError) {} });
    }

    if (!isGenerating && text.length > 0 && polls > 4) {
      clearInterval(activeObserver);
      chrome.runtime.sendMessage({
        type: 'STREAM_CHUNK_FROM_GEMINI',
        text: text,
        codeBlocks: codeBlocks,
        currentUrl: window.location.href,
        isDone: true
      }, () => { if (chrome.runtime.lastError) {} });
    }
  }, 300);
}