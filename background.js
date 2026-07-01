importScripts('launcher.js');

// Tracks the current active generation job ID
let currentJobId = null;

// Open sidebar when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ tabId: tab.id });
});

// Set sidebar panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Handle install/update
chrome.runtime.onInstalled.addListener(() => {
    console.log('Meta AI Automator installed');
});

/**
 * Message relay for lazy loading
 * Content script requests image data -> Background relays to Sidebar -> Sidebar responds with base64
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_IMAGE_DATA') {
        // Relay to all extension pages (sidebar will handle it)
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: 'Sidebar not available. Please keep sidebar open.' });
            } else {
                sendResponse(response);
            }
        });
        return true; // Keep channel open for async response
    }

    // Intercept runtime messages from content script for status streaming
    if (currentJobId) {
        if (message.type === 'PROGRESS_UPDATE') {
            if (message.status && (message.status.includes('Checking mode') || message.status.includes('Uploading') || message.status.includes('prompt') || message.status.includes('Setting'))) {
                sendStatus(currentJobId, 'running');
            } else if (message.status && (message.status.includes('Waiting for button') || message.status.includes('glow') || message.status.includes('activate'))) {
                sendStatus(currentJobId, 'waiting_generation');
            } else if (message.status && message.status.includes('Downloading')) {
                sendStatus(currentJobId, 'downloading');
            }
        } else if (message.type === 'AUTOMATION_COMPLETE') {
            sendStatus(currentJobId, 'completed');
            currentJobId = null;
        } else if (message.type === 'ITEM_ERROR' || message.type === 'AUTOMATION_STOPPED') {
            sendStatus(currentJobId, 'error');
            currentJobId = null;
        }
    }
    return false;
});

// ============================================================================
// WEBSOCKET PROTOTYPE CONNECTION & COMMAND DISPATCHER
// ============================================================================

let ws = null;

// Helper to send ACK response
function sendAck(msgId) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            id: msgId,
            type: "ACK",
            accepted: true
        }));
        console.log(`[Background SW] Sent ACK for message: ${msgId}`);
    }
}

// Helper to send ERROR response
function sendError(msgId, errorMessage) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            id: msgId,
            type: "ERROR",
            message: errorMessage
        }));
        console.log(`[Background SW] Sent ERROR for message ${msgId}: ${errorMessage}`);
    }
}

// Helper to send STATUS updates
function sendStatus(jobId, status) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            id: jobId,
            type: "STATUS",
            status: status
        }));
        console.log(`[Background SW] Sent STATUS for message ${jobId}: ${status}`);
    }
}

// Reusable command routing table
const handlerMap = {
    'PING': async (message) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'PONG' }));
            console.log('[Background SW] Responded to PING with PONG');
        }
    },
    'GENERATE': async (message) => {
        console.log('[Background SW] GENERATE request received:', message);
        
        const msgId = message.id;
        
        // 1. Validation
        if (!message.prompt || typeof message.prompt !== 'string' || message.prompt.trim() === '') {
            sendError(msgId, 'Missing or empty prompt in GENERATE payload.');
            return;
        }

        if (message.provider !== 'meta') {
            sendError(msgId, `Unsupported provider: ${message.provider}. Supported: 'meta'.`);
            return;
        }

        if (message.mode !== 'text') {
            sendError(msgId, `Unsupported mode: ${message.mode}. Supported: 'text'.`);
            return;
        }

        // Set job ID to map runtime status callbacks
        currentJobId = msgId;

        // Send Immediate ACK and Starting Status
        sendAck(msgId);
        sendStatus(msgId, 'starting');

        // 2. Build configuration
        const config = {
            queueMeta: [], // empty for text mode
            prompts: [message.prompt.trim()],
            totalItems: 1
        };

        // 3. Call startAutomation
        try {
            const success = await startAutomation(config, {
                onLog: (msg, type) => {
                    console.log(`[SW Log - ${type || 'info'}] ${msg}`);
                    
                    // Route status logs
                    if (msg.includes('Injecting') || msg.includes('Locating') || msg.includes('active tab')) {
                        sendStatus(msgId, 'opening_meta');
                    }

                    // Save to local storage log so the sidebar logs container displays it
                    chrome.storage.local.get(['logs'], (result) => {
                        const logs = result.logs || [];
                        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
                        logs.push({ time, message: `[SW] ${msg}`, type: type || 'info' });
                        if (logs.length > 50) logs.shift();
                        chrome.storage.local.set({ logs });
                    });
                },
                onStart: () => {
                    console.log('[Background SW] Automation run successfully launched via WebSocket.');
                    sendStatus(msgId, 'launching');
                },
                onError: (err) => {
                    console.error('[Background SW] Automation run failed to launch via WebSocket:', err);
                    sendStatus(msgId, 'error');
                    sendError(msgId, err);
                    currentJobId = null;
                }
            });

            if (!success) {
                sendStatus(msgId, 'error');
                sendError(msgId, 'Failed to launch automation (active tab check or injection failed).');
                currentJobId = null;
            }
        } catch (err) {
            console.error('[Background SW] startAutomation threw exception:', err.message);
            sendStatus(msgId, 'error');
            sendError(msgId, `Launcher exception: ${err.message}`);
            currentJobId = null;
        }
    }
};

/**
 * Route incoming messages to their mapped handlers
 */
async function dispatchMessage(message) {
    if (!message || !message.type) {
        console.warn('[Background SW] Received invalid message payload (missing "type"):', message);
        return;
    }

    const handler = handlerMap[message.type];
    if (handler) {
        try {
            await handler(message);
        } catch (err) {
            console.error(`[Background SW] Exception running handler for "${message.type}":`, err.message);
        }
    } else {
        console.log(`[Background SW] Unknown message type ignored: "${message.type}"`);
    }
}

function connectWebSocket() {
    console.log('[Background SW] Connecting to WebSocket at ws://localhost:8765...');
    
    try {
        ws = new WebSocket('ws://localhost:8765');
        
        ws.onopen = () => {
            console.log('[Background SW] WebSocket connected successfully.');
            const helloPayload = {
                type: "HELLO",
                extension: "Meta AI Automator",
                version: "0.2"
            };
            try {
                ws.send(JSON.stringify(helloPayload));
                console.log('[Background SW] Sent HELLO handshake payload:', helloPayload);
            } catch (err) {
                console.error('[Background SW] Failed to send HELLO:', err.message);
            }
        };

        ws.onmessage = async (event) => {
            console.log('[Background SW] WebSocket message received:', event.data);
            try {
                const message = JSON.parse(event.data);
                await dispatchMessage(message);
            } catch (err) {
                console.error('[Background SW] Failed to parse WebSocket message:', err.message);
            }
        };

        ws.onerror = (error) => {
            console.error('[Background SW] WebSocket error encountered:', error);
        };

        ws.onclose = (event) => {
            console.log('[Background SW] WebSocket closed. Reconnecting in 5 seconds...');
            ws = null;
            setTimeout(connectWebSocket, 5000);
        };
    } catch (e) {
        console.error('[Background SW] Exception during WebSocket connection initialization:', e.message);
        setTimeout(connectWebSocket, 5000);
    }
}

// Start client connection
connectWebSocket();
