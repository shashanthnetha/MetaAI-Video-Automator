/**
 * launcher.js - Reusable Automation Launcher for Meta AI Video Automator
 * 
 * Responsibilities:
 * - Clear old execution states
 * - Initialize chrome.storage.local run states
 * - Locate the active tab on Meta AI
 * - Inject content.js if missing
 * - Dispatch START_AUTOMATION message
 */

/**
 * Trigger the automation sequence on Meta AI
 * 
 * @param {Object} config - Execution configuration { queueMeta, prompts, totalItems }
 * @param {Object} callbacks - Status callbacks { onLog, onStart, onError }
 * @returns {Promise<boolean>} true if successfully started, false otherwise
 */
async function startAutomation(config, callbacks = {}) {
    const log = (msg, type) => callbacks.onLog ? callbacks.onLog(msg, type) : console.log(`[Launcher] ${msg}`);
    const start = () => callbacks.onStart ? callbacks.onStart() : null;
    const error = async (msg) => {
        log(msg, 'error');
        await chrome.storage.local.set({ isRunning: false });
        if (callbacks.onError) callbacks.onError(msg);
    };

    try {
        // 1. Clear previous run data
        await chrome.storage.local.clear();
        log('Cleared previous run data');

        // 2. Save run configuration to storage
        await chrome.storage.local.set({
            queueMeta: config.queueMeta || [],
            prompts: config.prompts || [],
            currentIndex: 0,
            isRunning: true,
            totalItems: config.totalItems || 0,
            logs: []
        });

        // 3. Locate the active tab
        // Log current and last focused windows before querying tabs
        const currentWindow = await chrome.windows.getCurrent();
        console.log('[Diagnostics] chrome.windows.getCurrent():', JSON.stringify(currentWindow, null, 2));
        log(`[Diagnostics] chrome.windows.getCurrent() ID: ${currentWindow?.id}`, 'info');

        const lastFocusedWindow = await chrome.windows.getLastFocused();
        console.log('[Diagnostics] chrome.windows.getLastFocused():', JSON.stringify(lastFocusedWindow, null, 2));
        log(`[Diagnostics] chrome.windows.getLastFocused() ID: ${lastFocusedWindow?.id}`, 'info');

        // Diagnostics logging for tabs
        const allTabs = await chrome.tabs.query({});
        console.log('[Diagnostics] Full result of chrome.tabs.query({}):', JSON.stringify(allTabs, null, 2));
        allTabs.forEach(t => {
            console.log(`[Diagnostics] Tab - ID: ${t.id}, Active: ${t.active}, WindowID: ${t.windowId}, URL: "${t.url}"`);
        });

        // Use last focused window ID to query active tab instead of relying on currentWindow
        const queryParams = { active: true };
        if (lastFocusedWindow && lastFocusedWindow.id !== undefined) {
            queryParams.windowId = lastFocusedWindow.id;
        } else {
            queryParams.currentWindow = true; // Fallback
        }

        const queryResult = await chrome.tabs.query(queryParams);
        console.log(`[Diagnostics] Full result of chrome.tabs.query(${JSON.stringify(queryParams)}):`, JSON.stringify(queryResult, null, 2));
        
        const [tab] = queryResult;
        console.log('[Diagnostics] Selected tab:', tab ? JSON.stringify(tab, null, 2) : 'null');
        
        if (tab) {
            const url = tab.url || "";
            console.log(`[Diagnostics] Exact URL string used for validation: "${url}"`);
            console.log(`[Diagnostics] url.includes("meta.ai/create") = ${url.includes("meta.ai/create")}`);
            console.log(`[Diagnostics] url.includes("meta.ai/media") = ${url.includes("meta.ai/media")}`);
            
            // New requested diagnostics
            console.log('[Diagnostics] tab.id:', tab.id);
            console.log('[Diagnostics] tab.windowId:', tab.windowId);
            console.log('[Diagnostics] tab.active:', tab.active);
            console.log('[Diagnostics] tab.url:', tab.url);
            console.log('[Diagnostics] queryResult length details:', queryResult.length === 1 ? 'exactly one tab' : `multiple tabs (count: ${queryResult.length})`);
            console.log('[Diagnostics] tab.url JSON.stringify character-for-character:', JSON.stringify(tab.url));
            
            log(`[Diagnostics] tab.id: ${tab.id}`, 'info');
            log(`[Diagnostics] tab.windowId: ${tab.windowId}`, 'info');
            log(`[Diagnostics] tab.active: ${tab.active}`, 'info');
            log(`[Diagnostics] tab.url: ${tab.url}`, 'info');
            log(`[Diagnostics] queryResult length details: ${queryResult.length === 1 ? 'exactly one tab' : 'multiple tabs (' + queryResult.length + ')'}`, 'info');
            log(`[Diagnostics] tab.url JSON.stringify: ${JSON.stringify(tab.url)}`, 'info');
        } else {
            console.log('[Diagnostics] No tab selected (query returned empty array).');
        }

        const isSupportedUrl = tab && tab.url && (tab.url.includes('meta.ai/create') || tab.url.includes('meta.ai/media'));
        if (!isSupportedUrl) {
            await error('Error: Please navigate to https://www.meta.ai/create or https://www.meta.ai/media');
            return false;
        }

        // 4. Send start message with fallback programmatic injection
        try {
            await chrome.tabs.sendMessage(tab.id, { type: 'START_AUTOMATION' });
            log('Starting automation...');
            start();
            return true;
        } catch (msgError) {
            log('Injecting content script...', 'info');
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
                // Delay briefly for script initialization
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Retry start message
                await chrome.tabs.sendMessage(tab.id, { type: 'START_AUTOMATION' });
                log('Starting automation...');
                start();
                return true;
            } catch (injectError) {
                await error('Error: Could not start automation. Please refresh the page.');
                return false;
            }
        }
    } catch (err) {
        await error(`Launcher error: ${err.message}`);
        return false;
    }
}
