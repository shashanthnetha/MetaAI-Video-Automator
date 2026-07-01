/**
 * sidebar.js - Handles sidebar UI interactions
 * 
 * Responsibilities:
 * - File selection and validation
 * - Prompt parsing
 * - Queue management via chrome.storage.local
 * - Communication with content script
 * - Progress display
 */

// DOM Elements
const imageInput = document.getElementById('imageInput');
const selectImagesBtn = document.getElementById('selectImagesBtn');
const promptsInput = document.getElementById('promptsInput');
const imageCount = document.getElementById('imageCount');
const promptCount = document.getElementById('promptCount');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const logContainer = document.getElementById('logContainer');
const wrongSiteOverlay = document.getElementById('wrongSiteOverlay');
const mainContainer = document.getElementById('mainContainer');

// State
let selectedFiles = [];
let isRunning = false;

/**
 * Check if current tab is on Meta AI website
 * @returns {Promise<boolean>} true if on meta.ai
 */
async function checkIfOnMetaSite() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
            return tab.url.includes('meta.ai');
        }
        return false;
    } catch (error) {
        console.error('Error checking site:', error);
        return false;
    }
}

/**
 * Show or hide the wrong site warning overlay
 * @param {boolean} isOnMetaSite - Whether user is on Meta AI
 */
function updateSiteWarning(isOnMetaSite) {
    if (isOnMetaSite) {
        wrongSiteOverlay.classList.add('hidden');
        mainContainer.classList.remove('blurred');
    } else {
        wrongSiteOverlay.classList.remove('hidden');
        mainContainer.classList.add('blurred');
    }
}

/**
 * Initialize sidebar - load any existing queue state
 */
async function init() {
    // Check if on Meta AI website
    const isOnMetaSite = await checkIfOnMetaSite();
    updateSiteWarning(isOnMetaSite);

    // Listen for tab changes to update warning
    chrome.tabs.onActivated.addListener(async () => {
        const onMeta = await checkIfOnMetaSite();
        updateSiteWarning(onMeta);
    });

    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
        if (changeInfo.url) {
            const onMeta = await checkIfOnMetaSite();
            updateSiteWarning(onMeta);
        }
    });

    // Load existing state from storage
    const state = await chrome.storage.local.get(['queue', 'currentIndex', 'isRunning', 'prompts']);

    if (state.isRunning) {
        isRunning = true;
        updateUIState();
        const total = state.prompts?.length || 0;
        const current = state.currentIndex || 0;
        updateProgress(current, total);
    }

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener(handleMessage);

    // Load log from storage
    const logState = await chrome.storage.local.get(['logs']);
    if (logState.logs) {
        logState.logs.forEach(entry => addLogEntry(entry.message, entry.type, false));
    }
}

/**
 * Handle messages from content script
 */
function handleMessage(message, sender, sendResponse) {
    switch (message.type) {
        case 'PROGRESS_UPDATE':
            updateProgress(message.current, message.total);
            addLogEntry(`Processing ${message.current}/${message.total}: ${message.status}`);
            break;

        case 'ITEM_COMPLETE':
            addLogEntry(`✓ Completed item ${message.index + 1}`, 'success');
            break;

        case 'ITEM_ERROR':
            addLogEntry(`✗ Error on item ${message.index + 1}: ${message.error}`, 'error');
            break;

        case 'AUTOMATION_COMPLETE':
            isRunning = false;
            updateUIState();
            addLogEntry('✓ Automation complete!', 'success');
            progressText.textContent = 'Complete';
            break;

        case 'AUTOMATION_STOPPED':
            isRunning = false;
            updateUIState();
            addLogEntry('⏹ Automation stopped', 'error');
            progressText.textContent = 'Stopped';
            break;

        case 'GET_IMAGE_DATA':
            // LAZY LOADING: Convert single image to base64 on-demand
            // This prevents memory exhaustion when handling 30+ images
            (async () => {
                const index = message.index;
                if (index >= 0 && index < selectedFiles.length) {
                    try {
                        const imageData = await fileToBase64(selectedFiles[index]);
                        sendResponse({ success: true, imageData: imageData });
                    } catch (error) {
                        sendResponse({ success: false, error: error.message });
                    }
                } else {
                    sendResponse({ success: false, error: 'Invalid index' });
                }
            })();
            return true; // Keep channel open for async response
    }
}

/**
 * Trigger file picker
 */
selectImagesBtn.addEventListener('click', () => {
    imageInput.click();
});

/**
 * Handle file selection
 */
imageInput.addEventListener('change', (e) => {
    selectedFiles = Array.from(e.target.files);
    const count = selectedFiles.length;
    imageCount.textContent = `${count} image${count !== 1 ? 's' : ''} selected`;

    // Log selected files
    if (count > 0) {
        addLogEntry(`Selected ${count} images`);
    }
});

/**
 * Handle prompt input changes
 */
promptsInput.addEventListener('input', () => {
    const prompts = getPrompts();
    promptCount.textContent = `${prompts.length} prompt${prompts.length !== 1 ? 's' : ''}`;
});

/**
 * Parse prompts from textarea
 */
function getPrompts() {
    return promptsInput.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
}

/**
 * Convert File to base64 for storage
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result });
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Start automation - uses lazy loading to handle 30+ images
 * Images are converted to base64 one-at-a-time on demand
 */
startBtn.addEventListener('click', async () => {
    const prompts = getPrompts();

    // Validation
    if (selectedFiles.length === 0 && prompts.length === 0) {
        addLogEntry('Error: No images selected and no prompts entered', 'error');
        return;
    }

    if (prompts.length === 0) {
        addLogEntry('Error: No prompts entered', 'error');
        return;
    }

    if (selectedFiles.length > 0 && selectedFiles.length !== prompts.length) {
        addLogEntry(`Error: Image count (${selectedFiles.length}) != prompt count (${prompts.length})`, 'error');
        return;
    }

    // LAZY LOADING: Only store metadata, not full image data
    // This avoids chrome.storage.local quota limits (10MB max)
    const queueMeta = selectedFiles.map(f => ({
        name: f.name,
        size: f.size,
        type: f.type
    }));

    if (selectedFiles.length > 0) {
        addLogEntry(`Preparing ${selectedFiles.length} images (lazy loading enabled)...`);
    } else {
        addLogEntry('Preparing text-only automation...');
    }

    // Execute via reusable launcher module
    await startAutomation(
        {
            queueMeta: queueMeta,
            prompts: prompts,
            totalItems: selectedFiles.length > 0 ? selectedFiles.length : prompts.length
        },
        {
            onLog: (message, type) => addLogEntry(message, type),
            onStart: () => {
                isRunning = true;
                updateUIState();
                updateProgress(0, prompts.length);
            },
            onError: (err) => {
                isRunning = false;
                updateUIState();
            }
        }
    );
});

/**
 * Stop automation
 */
stopBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab) {
        try {
            await chrome.tabs.sendMessage(tab.id, { type: 'STOP_AUTOMATION' });
        } catch (error) {
            // Content script may not be available, just update local state
            console.log('Could not reach content script, updating local state only');
        }
    }

    await chrome.storage.local.set({ isRunning: false });
    isRunning = false;
    updateUIState();
    addLogEntry('Stopping automation...');
});

/**
 * Update UI based on running state
 */
function updateUIState() {
    startBtn.disabled = isRunning;
    stopBtn.disabled = !isRunning;
    selectImagesBtn.disabled = isRunning;
    promptsInput.disabled = isRunning;
}

/**
 * Update progress bar and text
 */
function updateProgress(current, total) {
    const percent = total > 0 ? (current / total) * 100 : 0;
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `Processing ${current}/${total}`;
}

/**
 * Add entry to activity log
 */
function addLogEntry(message, type = 'info', save = true) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const time = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    entry.innerHTML = `<span class="time">[${time}]</span> ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;

    // Save to storage for persistence
    if (save) {
        chrome.storage.local.get(['logs'], (result) => {
            const logs = result.logs || [];
            logs.push({ time, message, type });
            // Keep only last 50 entries
            if (logs.length > 50) logs.shift();
            chrome.storage.local.set({ logs });
        });
    }
}

// Initialize
init();
