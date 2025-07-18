// background.js

const STORAGE = chrome.storage.local;

// Default settings
const defaultSettings = {
  badgeEnabled: false,
  blankItems: false,
  theme: 'system',
  itemLimit: 20
};

async function loadSettings() {
  const result = await STORAGE.get({ settings: defaultSettings });
  return result.settings;
}

// Add caching layer
let snippetsCache = null;
let cacheTimestamp = 0;

async function loadSnippets(force = false) {
  if (snippetsCache && !force) return snippetsCache;
  const result = await STORAGE.get({ snippets: [] });
  snippetsCache = result.snippets;
  cacheTimestamp = Date.now();
  return snippetsCache;
}

async function saveSnippets(snippets) {
  snippetsCache = snippets;
  cacheTimestamp = Date.now();
  await STORAGE.set({ snippets });
}

// Invalidate cache if storage changes externally
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.snippets) {
    snippetsCache = changes.snippets.newValue;
    cacheTimestamp = Date.now();
  }
});

async function updateBadge() {
  const settings = await loadSettings();
  if (!settings.badgeEnabled) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  
  const snippets = await loadSnippets();
  const totalItems = snippets.length;
  chrome.action.setBadgeText({ text: totalItems.toString() });
  chrome.action.setBadgeBackgroundColor({ color: '#4f8cff' });
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (
        tab.id &&
        tab.url?.startsWith("http") &&
        !tab.url.startsWith("https://chrome.google.com/webstore") &&
        tab.status === "complete" &&
        !tab.url.startsWith("chrome://") &&
        !tab.url.startsWith("chrome-extension://")
      ) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["contentScript.js"]
          });
        } catch (e) {
          console.warn("Failed to inject script into tab", tab.id, e);
        }
      }
    }
  } catch (error) {
    console.warn("Error during installation script injection:", error);
  }
  
  // Initialize settings if not exists
  try {
    const result = await STORAGE.get({ settings: null });
    if (!result.settings) {
      await STORAGE.set({ settings: defaultSettings });
    }
  } catch (error) {
    console.warn("Error initializing settings:", error);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url?.startsWith("http") &&
    !tab.url.startsWith("https://chrome.google.com/webstore") &&
    !tab.url.startsWith("chrome://") &&
    !tab.url.startsWith("chrome-extension://") &&
    tab.status === "complete"
  ) {
    try {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["contentScript.js"]
      }).catch(error => {
        console.warn("Failed to inject script into tab", tabId, error);
      });
    } catch (error) {
      console.warn("Error in tab update listener:", error);
    }
  }
});

chrome.runtime.onMessage.addListener(async (message, sender) => {
  try {
    if (message.type === "copiedText") {
      const settings = await loadSettings();
      let snippets = await loadSnippets();
      
      // Check if we should allow blank items
      const newText = message.text.trim();
      if (!settings.blankItems && !newText) {
        return;
      }
      
      // Deduplicate by case-insensitive, trimmed text
      if (
        newText &&
        !snippets.some(s => s.text.trim().toLowerCase() === newText.toLowerCase())
      ) {
        // Enforce 5,000 character limit per item
        const limitedText = newText.slice(0, 5000);
        snippets.unshift({ text: limitedText, copiedAt: Date.now() });
        
        // Apply item limit
        if (snippets.length > settings.itemLimit) {
          snippets = snippets.slice(0, settings.itemLimit);
        }
        
        await saveSnippets(snippets);
        updateBadge();
      }
    }
    
    // Handle settings updates
    if (message.type === "settingsUpdated") {
      updateBadge();
    }
  } catch (error) {
    console.warn("Error handling message:", error);
  }
}); 