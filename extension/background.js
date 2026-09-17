chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// When extension is installed or reloaded, auto-inject content script into existing Gemini tabs
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: '*://gemini.google.com/*' });
    for (const tab of tabs) {
      if (tab.id && !tab.discarded) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content_gemini.js']
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[Background] onInstalled injection note:', e.message);
  }
});

// Helper to find the most relevant Gemini tab
async function getBestGeminiTab() {
  const tabs = await chrome.tabs.query({});
  const geminiTabs = tabs.filter(t => t.url && t.url.includes('gemini.google.com'));
  if (geminiTabs.length === 0) return null;

  // 1. Active tab in current window
  const activeCurrent = geminiTabs.find(t => t.active);
  if (activeCurrent) return activeCurrent;

  // 2. Most recently accessed non-discarded tab
  const validTabs = geminiTabs.filter(t => !t.discarded);
  const candidates = validTabs.length > 0 ? validTabs : geminiTabs;
  candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return candidates[0];
}

// Ensure content script is alive in target tab
async function ensureContentScriptInTab(tabId) {
  try {
    const pong = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 300);
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (res) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !res || !res.pong) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });

    if (pong) return true;
  } catch (e) {}

  console.log('[Background] Injecting content_gemini.js into tab', tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content_gemini.js']
    });
    // Brief settle time
    await new Promise(r => setTimeout(r, 250));
    return true;
  } catch (err) {
    console.error('[Background] Failed to inject content script:', err.message);
    return false;
  }
}

// Send message to tab with automatic injection and retry
async function sendMessageToGeminiTab(tabId, message) {
  await ensureContentScriptInTab(tabId);

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, async (res) => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.warn('[Background] First sendMessage attempt failed:', err.message);
        // Force re-inject and try once more
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content_gemini.js']
          });
          await new Promise(r => setTimeout(r, 300));
          chrome.tabs.sendMessage(tabId, message, (retryRes) => {
            const retryErr = chrome.runtime.lastError;
            if (retryErr) {
              resolve({ success: false, error: retryErr.message });
            } else {
              resolve(retryRes || { success: true });
            }
          });
        } catch (injectErr) {
          resolve({ success: false, error: err.message });
        }
      } else {
        resolve(res || { success: true });
      }
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SEND_TO_GEMINI') {
    (async () => {
      let targetTab = await getBestGeminiTab();

      if (!targetTab) {
        // Auto-open Gemini tab if none exists
        chrome.tabs.create({ url: 'https://gemini.google.com/app' });
        sendResponse({
          success: false,
          error: 'NO_GEMINI_TAB',
          message: '未检测到打开的 Gemini 网页，已为你自动新建标签页，请稍等页面加载完毕后重新发送！'
        });
        return;
      }

      const result = await sendMessageToGeminiTab(targetTab.id, {
        type: 'INPUT_PROMPT',
        prompt: request.prompt,
        images: request.images || []
      });

      sendResponse(result);
    })();
    return true;
  }

  // Trigger New Chat on web page directly
  if (request.type === 'RESET_GEMINI_NEW_CHAT') {
    (async () => {
      let targetTab = await getBestGeminiTab();
      if (targetTab) {
        const result = await sendMessageToGeminiTab(targetTab.id, { type: 'TRIGGER_NEW_CHAT' });
        if (!result.success) {
          // Fallback URL navigate
          chrome.tabs.update(targetTab.id, { url: 'https://gemini.google.com/app' });
        }
      } else {
        chrome.tabs.create({ url: 'https://gemini.google.com/app' });
      }
      sendResponse({ success: true });
    })();
    return true;
  }

  // Navigate Gemini tab to specific conversation URL
  if (request.type === 'NAVIGATE_GEMINI_URL') {
    (async () => {
      let targetTab = await getBestGeminiTab();
      if (targetTab) {
        chrome.tabs.update(targetTab.id, { url: request.url });
        sendResponse({ success: true });
      } else {
        chrome.tabs.create({ url: request.url });
        sendResponse({ success: true });
      }
    })();
    return true;
  }

  if (request.type === 'STREAM_CHUNK_FROM_GEMINI') {
    chrome.runtime.sendMessage(request, () => {
      if (chrome.runtime.lastError) {}
    });
  }
});