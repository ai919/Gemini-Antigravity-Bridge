chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SEND_TO_GEMINI') {
    chrome.tabs.query({}, (tabs) => {
      const geminiTabs = tabs.filter(t => t.url && t.url.includes('gemini.google.com'));
      if (geminiTabs.length === 0) {
        sendResponse({ success: false, error: 'NO_GEMINI_TAB' });
        return;
      }
      
      const targetTab = geminiTabs.find(t => t.active) || geminiTabs[geminiTabs.length - 1];

      chrome.tabs.sendMessage(targetTab.id, {
        type: 'INPUT_PROMPT',
        prompt: request.prompt,
        images: request.images || []
      }, (res) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse(res || { success: true });
        }
      });
    });
    return true;
  }

  // Trigger New Chat on web page directly
  if (request.type === 'RESET_GEMINI_NEW_CHAT') {
    chrome.tabs.query({}, (tabs) => {
      const geminiTabs = tabs.filter(t => t.url && t.url.includes('gemini.google.com'));
      if (geminiTabs.length > 0) {
        const targetTab = geminiTabs.find(t => t.active) || geminiTabs[0];
        chrome.tabs.sendMessage(targetTab.id, { type: 'TRIGGER_NEW_CHAT' }, () => {
          if (chrome.runtime.lastError) {
            // Fallback navigate
            chrome.tabs.update(targetTab.id, { url: 'https://gemini.google.com/app' });
          }
        });
      } else {
        chrome.tabs.create({ url: 'https://gemini.google.com/app' });
      }
      sendResponse({ success: true });
    });
    return true;
  }

  // Navigate Gemini tab to specific conversation URL
  if (request.type === 'NAVIGATE_GEMINI_URL') {
    chrome.tabs.query({}, (tabs) => {
      const geminiTabs = tabs.filter(t => t.url && t.url.includes('gemini.google.com'));
      if (geminiTabs.length > 0) {
        const targetTab = geminiTabs.find(t => t.active) || geminiTabs[0];
        chrome.tabs.update(targetTab.id, { url: request.url });
        sendResponse({ success: true });
      } else {
        chrome.tabs.create({ url: request.url });
        sendResponse({ success: true });
      }
    });
    return true;
  }

  if (request.type === 'STREAM_CHUNK_FROM_GEMINI') {
    chrome.runtime.sendMessage(request, () => {
      if (chrome.runtime.lastError) {}
    });
  }
});