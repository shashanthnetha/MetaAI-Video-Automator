/**
 * content.js - DOM Automation for Meta AI Image-to-Video
 * 
 * Target URL: https://www.meta.ai/media
 * 
 * DOM SELECTORS (verified from user-provided page inspection):
 * 
 * Prompt Input:
 * - Selector: div[aria-label="Describe your image..."][contenteditable="true"]
 * - Type: Contenteditable div with Lexical editor
 * - Interaction: Set textContent and dispatch 'input' event
 * 
 * Add Media Button:
 * - Selector: div[aria-label="Add media"][role="button"]
 * - Triggers file upload dialog
 * 
 * Create Button:
 * - Selector: div[aria-label="Create"][role="button"]
 * - Triggers image/video generation
 * 
 * Send Button:
 * - Selector: div[aria-label="Send"][role="button"]
 * - Alternative submit (may be disabled until prompt entered)
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // Configurable prompt prefix for video generations on unified UI
    VIDEO_PREFIX: "Create a cinematic video of ",

    // Timing
    MIN_DELAY: 5000,        // 5 seconds minimum between items
    MAX_DELAY: 15000,       // 15 seconds maximum between items
    TIMEOUT: 120000,        // 2 minutes timeout per generation
    POLL_INTERVAL: 500,     // Check every 500ms for completion
    BUTTON_ENABLE_TIMEOUT: 60000,  // 60 seconds max wait for button to enable
    BUTTON_CHECK_INTERVAL: 300,    // Check every 300ms for button state

    // DOM Selectors - Multiple fallbacks for each element
    SELECTORS: {
        // Multiple selectors for prompt input (tried in order)
        promptInputSelectors: [
            '[data-testid="composer-input"][contenteditable="true"]',
            'div[contenteditable="true"][data-lexical-editor="true"]',
            'div[aria-label="Describe your image..."][contenteditable="true"]',
            'div[contenteditable="true"][role="textbox"]',
            '[contenteditable="true"][aria-placeholder]',
            'div[contenteditable="true"].notranslate',
            'textarea[placeholder*="Describe"]',
            'textarea[placeholder*="prompt"]',
            '[role="textbox"][contenteditable="true"]',
            'div[contenteditable="true"]'
        ],
        // Multiple selectors for Add Media button
        addMediaBtnSelectors: [
            'div[aria-label="Add media"][role="button"]',
            'div[aria-label="Add Media"][role="button"]',
            'button[aria-label="Add media"]',
            'button[aria-label="Add Media"]',
            '[aria-label*="media"][role="button"]',
            '[aria-label*="Media"][role="button"]',
            'input[type="file"][accept*="image"]'
        ],
        // Multiple selectors for Create button
        createBtnSelectors: [
            'div[aria-label="Create"][role="button"]',
            'button[aria-label="Create"]',
            'div[aria-label="Generate"][role="button"]',
            'button[aria-label="Generate"]',
            '[aria-label="Submit"][role="button"]'
        ],
        // Multiple selectors for Send/Animate button (primary selector based on dev tools)
        sendBtnSelectors: [
            'div[role="button"][aria-label="Send"]',
            'div[aria-label="Send"][role="button"]',
            '.x1ed109x.x1n2onr6.xh8yej3 div[role="button"][aria-label="Send"]',
            'button[aria-label="Send"]',
            '[aria-label="Send message"][role="button"]'
        ],
        // Mode toggle (Image/Video) selectors
        modeToggleSelectors: [
            'div[role="button"][aria-label="Image"]',
            'div[role="button"][aria-label="Video"]',
            'div#_r_7d_[role="button"]'
        ],
        // Download button detection
        downloadBtn: 'a[download], div[aria-label="Download"][role="button"], button[aria-label="Download"], [aria-label*="download" i][role="button"]',
        // Loading indicator
        loadingSpinner: '[role="progressbar"], .loading, [aria-busy="true"], [data-loading="true"]'
    }
};

// ============================================================================
// STATE
// ============================================================================

let isRunning = false;
let shouldStop = false;
let currentObserver = null;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Wait for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get random delay between min and max
 */
function getRandomDelay() {
    return Math.floor(Math.random() * (CONFIG.MAX_DELAY - CONFIG.MIN_DELAY + 1)) + CONFIG.MIN_DELAY;
}

/**
 * Find element with retry
 */
async function findElement(selector, maxAttempts = 10, delay = 500) {
    for (let i = 0; i < maxAttempts; i++) {
        const element = document.querySelector(selector);
        if (element) return element;
        await sleep(delay);
    }
    return null;
}

/**
 * Find element from array of selectors (tries each in order with retry)
 */
async function findElementFromSelectors(selectors, maxAttempts = 10, delay = 500) {
    // First, try each selector immediately
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
            log(`Found element with selector: ${selector}`);
            return element;
        }
    }

    // If not found, retry with delays
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await sleep(delay);
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                log(`Found element with selector: ${selector} (attempt ${attempt + 1})`);
                return element;
            }
        }
    }

    // Log which selectors were tried for debugging
    log(`Could not find element. Tried selectors: ${selectors.slice(0, 3).join(', ')}...`, 'error');
    return null;
}

/**
 * Convert base64 to File object
 */
function base64ToFile(base64Data, fileName, mimeType) {
    const arr = base64Data.split(',');
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], fileName, { type: mimeType });
}

/**
 * Convert base64 data URL to Blob
 */
function base64ToBlob(base64Data, mimeType) {
    const parts = base64Data.split(',');
    const byteString = atob(parts[1]);
    const arrayBuffer = new ArrayBuffer(byteString.length);
    const uint8Array = new Uint8Array(arrayBuffer);

    for (let i = 0; i < byteString.length; i++) {
        uint8Array[i] = byteString.charCodeAt(i);
    }

    return new Blob([uint8Array], { type: mimeType });
}

/**
 * Send message to sidebar
 */
function sendToSidebar(message) {
    chrome.runtime.sendMessage(message);
}

/**
 * Log to console with prefix
 */
function log(message, type = 'info') {
    const prefix = '[Meta AI Automator]';
    if (type === 'error') {
        console.error(prefix, message);
    } else {
        console.log(prefix, message);
    }
}

// ============================================================================
// DOM INTERACTION FUNCTIONS
// ============================================================================

/**
 * Set text in the prompt input (contenteditable div)
 */
async function setPromptText(text) {
    const promptInput = await findElementFromSelectors(CONFIG.SELECTORS.promptInputSelectors);

    if (!promptInput) {
        throw new Error('Could not find prompt input');
    }

    // Clear existing content
    promptInput.textContent = '';

    // Focus the element
    promptInput.focus();

    // Set new content
    promptInput.textContent = text;

    // Dispatch input event for React/Lexical to pick up
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Also try InputEvent for better compatibility
    promptInput.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
    }));

    log(`Set prompt: "${text.substring(0, 50)}..."`);
    await sleep(300);
}

/**
 * Upload image via clipboard paste into the prompt input
 * This bypasses the need for file dialog which requires user activation
 */
async function uploadImage(imageData) {
    log(`Starting image upload for: ${imageData.name}`);

    // Find the prompt input (contenteditable div)
    const promptInput = await findElementFromSelectors(CONFIG.SELECTORS.promptInputSelectors);

    if (!promptInput) {
        throw new Error('Could not find prompt input for image paste');
    }

    // Focus the input first
    promptInput.focus();
    await sleep(300);

    // Convert base64 to blob
    const blob = base64ToBlob(imageData.data, imageData.type);

    // Create a File from the blob
    const file = new File([blob], imageData.name, { type: imageData.type });

    // Create DataTransfer with the file
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    // Method 1: Try direct paste event with DataTransfer (skipping Clipboard API to avoid focus errors)
    try {
        log('Using direct paste event method...');
        promptInput.focus();
        await sleep(100);

        // Create a custom paste event with file data
        const customPasteEvent = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(customPasteEvent, 'clipboardData', {
            value: {
                files: dataTransfer.files,
                items: dataTransfer.items,
                types: ['Files'],
                getData: () => ''
            }
        });

        promptInput.dispatchEvent(customPasteEvent);
        log('Dispatched paste event');

        await sleep(1500);

        // Check if upload was successful
        if (await waitForImagePreview()) {
            log(`Successfully uploaded image via paste: ${imageData.name}`);
            return;
        }
    } catch (e) {
        log(`Paste event failed: ${e.message}`, 'error');
    }

    // Method 2: Try beforeinput event with DataTransfer
    try {
        log('Trying beforeinput event method...');
        promptInput.focus();
        await sleep(100);

        // Create a more comprehensive paste event
        const inputEvent = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertFromPaste',
            dataTransfer: dataTransfer
        });
        promptInput.dispatchEvent(inputEvent);

        await sleep(1500);

        if (await waitForImagePreview()) {
            log(`Successfully uploaded image via beforeinput: ${imageData.name}`);
            return;
        }
    } catch (e) {
        log(`Beforeinput event failed: ${e.message}`, 'error');
    }

    // Method 3: Try drag and drop on the prompt input itself
    try {
        log('Trying drag and drop on prompt input...');
        await simulateDragDropOnElement(promptInput, file);
        await sleep(2000);

        if (await waitForImagePreview()) {
            log(`Successfully uploaded image via drag-drop: ${imageData.name}`);
            return;
        }
    } catch (e) {
        log(`Drag drop on input failed: ${e.message}`, 'error');
    }

    // Method 4: Try clicking Add Media and looking for hidden input
    log('Trying Add Media button method as last resort...');
    const addMediaBtn = await findElementFromSelectors(CONFIG.SELECTORS.addMediaBtnSelectors, 3);

    if (addMediaBtn) {
        // Look for any file inputs that might already exist
        const existingInputs = document.querySelectorAll('input[type="file"]');

        for (const input of existingInputs) {
            try {
                input.files = dataTransfer.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                await sleep(1000);

                if (await waitForImagePreview(1000)) {
                    log(`Uploaded via existing input: ${imageData.name}`);
                    return;
                }
            } catch (e) {
                // continue to next input
            }
        }
    }

    log('All upload methods attempted - proceeding with generation', 'error');
}

/**
 * Wait for image preview to appear (indicates successful upload)
 */
async function waitForImagePreview(timeout = 3000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        // Look for common image preview indicators
        const previewSelectors = [
            'img[src*="blob:"]',
            'img[src*="data:image"]',
            '[aria-label*="preview" i]',
            '[aria-label*="Remove" i][role="button"]',  // Remove button appears when image is uploaded
            '[aria-label*="image" i][role="img"]',
            '.image-preview',
            '[data-testid*="image"]',
            'div[style*="background-image"]'
        ];

        for (const selector of previewSelectors) {
            const preview = document.querySelector(selector);
            if (preview) {
                log('Image preview detected');
                return true;
            }
        }

        await sleep(200);
    }

    return false;
}

/**
 * Simulate drag and drop specifically on an element
 */
async function simulateDragDropOnElement(element, file) {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    Object.defineProperty(dataTransfer, 'dropEffect', { value: 'copy', writable: true });
    Object.defineProperty(dataTransfer, 'effectAllowed', { value: 'all', writable: true });

    // Dispatch drag events on the specific element
    element.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
    await sleep(50);

    element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
    await sleep(50);

    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));

    log('Drag-drop dispatched on element');
}

/**
 * Simulate drag and drop for file upload
 * Enhanced to find proper drop zones on Meta AI
 */
async function simulateDragDrop(file) {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    // Set proper drop effect
    Object.defineProperty(dataTransfer, 'dropEffect', {
        value: 'copy',
        writable: true
    });
    Object.defineProperty(dataTransfer, 'effectAllowed', {
        value: 'all',
        writable: true
    });

    // Try to find the best drop zone - look for common container patterns
    const dropZoneSelectors = [
        '[aria-label*="media" i]',
        '[aria-label*="upload" i]',
        '[role="main"]',
        '.x1n2onr6',
        '[data-testid*="composer"]',
        '[contenteditable="true"]',
        'main',
        '#root',
        'body'
    ];

    let dropZone = null;
    for (const selector of dropZoneSelectors) {
        dropZone = document.querySelector(selector);
        if (dropZone) {
            log(`Using drop zone: ${selector}`);
            break;
        }
    }

    dropZone = dropZone || document.body;

    // Dispatch dragenter
    dropZone.dispatchEvent(new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        dataTransfer
    }));

    await sleep(100);

    // Dispatch dragover multiple times (some sites need this)
    for (let i = 0; i < 3; i++) {
        dropZone.dispatchEvent(new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer
        }));
        await sleep(50);
    }

    await sleep(100);

    // Dispatch drop
    dropZone.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer
    }));

    // Also dispatch dragleave for cleanup
    dropZone.dispatchEvent(new DragEvent('dragleave', {
        bubbles: true,
        cancelable: true,
        dataTransfer
    }));

    log('Simulated drag and drop');
}

/**
 * Check if the current page is the new unified Meta AI Create UI
 */
function isUnifiedInterface() {
    const isNew = document.querySelector('[data-testid="composer-input"]') !== null;
    return isNew;
}

/**
 * Wait for the Meta Unified Create UI elements to render and hydrate
 */
async function waitForUnifiedCreateReady() {
    log('Waiting for Meta Unified Create UI...');
    
    const startTime = Date.now();
    const timeout = 15000;
    const interval = 100;

    while (Date.now() - startTime < timeout) {
        const composer = document.querySelector('[data-testid="composer-input"][contenteditable="true"]');
        const createBtn = document.querySelector('button[aria-label="Create"]');

        if (composer && createBtn) {
            log('Meta Unified Create UI detected (composer and Create button found).');
            return true;
        }

        await sleep(interval);
    }

    log('Timeout waiting for Meta Unified Create UI.', 'error');
    throw new Error('Timeout waiting for Meta Unified Create UI.');
}

/**
 * Find the Send/Animate button element
 */
function findSendButton() {
    if (isUnifiedInterface()) {
        const btn = document.querySelector('button[aria-label="Create"]');
        if (btn) return btn;
    }

    // Primary selector based on dev tools analysis
    let btn = document.querySelector('div[role="button"][aria-label="Send"]');
    if (btn) return btn;

    // Try other selectors
    for (const selector of CONFIG.SELECTORS.sendBtnSelectors) {
        btn = document.querySelector(selector);
        if (btn) return btn;
    }

    return null;
}

// ============================================================================
// MODE DETECTION FUNCTIONS (Image/Video Toggle)
// ============================================================================

/**
 * Get the current mode (Image or Video) from the toggle button
 * @returns {Promise<'Image'|'Video'|null>} Current mode or null if not found
 */
async function getCurrentMode() {
    log('getCurrentMode() checking imageBtn...');
    const imageBtn = document.querySelector('div[role="button"][aria-label="Image"]');
    if (imageBtn) {
        log('getCurrentMode() found imageBtn, returning Image');
        return 'Image';
    }

    log('getCurrentMode() checking videoBtn...');
    const videoBtn = document.querySelector('div[role="button"][aria-label="Video"]');
    if (videoBtn) {
        log('getCurrentMode() found videoBtn, returning Video');
        return 'Video';
    }

    log('getCurrentMode() checking dynamicBtn (div#_r_7d_[role="button"])...');
    const dynamicBtn = document.querySelector('div#_r_7d_[role="button"]');
    if (dynamicBtn) {
        const val = dynamicBtn.getAttribute('aria-label');
        log(`getCurrentMode() found dynamicBtn, returning aria-label: "${val}"`);
        return val;
    }

    log('getCurrentMode() - no mode elements detected on screen.');
    return null;
}

/**
 * Find the Video option in the dropdown menu after clicking the mode toggle
 * @returns {Promise<Element|null>} Video option element or null
 */
async function findVideoOption() {
    // Wait a moment for dropdown to appear
    log('findVideoOption() waiting 300ms...');
    await sleep(300);

    // Look for any menu item containing "Video" text
    const menuSelectors = '[role="menuitem"], [role="option"], [role="menu"] div[role="button"]';
    log(`findVideoOption() querying menu items with selector: "${menuSelectors}"`);
    const allMenuItems = document.querySelectorAll(menuSelectors);
    log(`findVideoOption() found ${allMenuItems.length} menu items.`);
    
    let index = 0;
    for (const item of allMenuItems) {
        const text = item.textContent || item.innerText || '';
        const label = item.getAttribute('aria-label') || '';
        log(`  [Menu Item ${index++}] Text: "${text.trim()}", aria-label: "${label}"`);
        if (text.trim() === 'Video' || label === 'Video') {
            log('✓ findVideoOption() found Video option in menu items!');
            return item;
        }
    }

    // Fallback: look for aria-label
    log('findVideoOption() checking fallback selectors...');
    const fallbackSelector1 = '[aria-label="Video"][role="menuitem"]';
    const fallback1 = document.querySelector(fallbackSelector1);
    if (fallback1) {
        log(`✓ findVideoOption() found Video option via fallback selector: "${fallbackSelector1}"`);
        return fallback1;
    }

    const fallbackSelector2 = '[aria-label="Video"][role="option"]';
    const fallback2 = document.querySelector(fallbackSelector2);
    if (fallback2) {
        log(`✓ findVideoOption() found Video option via fallback selector: "${fallbackSelector2}"`);
        return fallback2;
    }

    log('✗ findVideoOption() failed to locate Video option in menu.');
    return null;
}

/**
 * Wait for the Meta AI UI to become fully interactive
 * @returns {Promise<boolean>} true if ready, false or throws on timeout
 */
async function waitForMetaReady() {
    log('Waiting for Meta UI...');
    
    const startTime = Date.now();
    const timeout = 15000;
    const interval = 100;

    while (Date.now() - startTime < timeout) {
        const imageBtn = document.querySelector('div[role="button"][aria-label="Image"]');
        const videoBtn = document.querySelector('div[role="button"][aria-label="Video"]');

        if (imageBtn || videoBtn) {
            log('Video/Image toggle detected.');
            log('Meta UI ready.');
            return true;
        }

        await sleep(interval);
    }

    log('Timeout waiting for Meta UI.', 'error');
    throw new Error('Timeout waiting for Meta UI.');
}

/**
 * Scan DOM looking for portal and menu elements after toggle click
 */
async function inspectDropdownDOM() {
    log('--- START DROPDOWN DOM INSPECTION ---');
    await sleep(1000); // Wait for popup to render

    const targetKeywords = ['video', 'image', 'animation', 'create'];
    
    // Inspect specific roles and containers
    const querySelectors = [
        '[role="dialog"]',
        '[role="menu"]',
        '[role="listbox"]',
        '[role="tabpanel"]',
        '[role="presentation"]',
        '[popover]',
        'body > div' // portal containers
    ];

    log('Scanning specific containers...');
    querySelectors.forEach(sel => {
        const elements = document.querySelectorAll(sel);
        if (elements.length > 0) {
            log(`Found ${elements.length} elements matching container selector: "${sel}"`);
            elements.forEach((el, idx) => {
                log(`Container [${sel}] [${idx}]: tagName=${el.tagName}, id=${el.id}, class="${el.className}"`);
            });
        }
    });

    log('Scanning all DOM elements for keywords: ' + targetKeywords.join(', '));
    const allElements = document.querySelectorAll('*');
    let matchCount = 0;
    
    allElements.forEach(el => {
        // Skip script, style, head, meta tags
        const tag = el.tagName.toLowerCase();
        if (['script', 'style', 'head', 'meta', 'link', 'noscript'].includes(tag)) {
            return;
        }

        // Check text content or attribute values
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        const className = el.className || '';

        const matchesKeyword = targetKeywords.some(keyword => 
            text === keyword || ariaLabel === keyword || ariaLabel.includes(keyword)
        );

        if (matchesKeyword) {
            matchCount++;
            console.log(`[DOM Match #${matchCount}]`, {
                tagName: el.tagName,
                role: el.getAttribute('role') || 'null',
                ariaLabel: el.getAttribute('aria-label') || 'null',
                class: className,
                innerText: el.innerText ? el.innerText.trim().substring(0, 100) : 'null',
                id: el.id || 'null',
                html: el.outerHTML.substring(0, 200) + '...'
            });
        }
    });
    
    log(`--- END DROPDOWN DOM INSPECTION (Found ${matchCount} matches) ---`);
}

/**
 * Ensure the Meta AI is in Video mode before pasting images
 * If currently in Image mode, switch to Video mode
 * @returns {Promise<boolean>} true if now in Video mode, false if failed
 */
async function ensureVideoMode() {
    log('--- START DIAGNOSTICS: ensureVideoMode() ---');

    const currentMode = await getCurrentMode();
    log(`[Diagnostics] Current mode detected initially: "${currentMode}"`);

    if (currentMode === 'Video') {
        log('✓ Already in Video mode. No action needed.');
        log('--- END DIAGNOSTICS: ensureVideoMode() ---');
        return true;
    }

    if (currentMode === 'Image' || currentMode === null) {
        log(`[Diagnostics] Mode is "${currentMode}". Attempting switch...`);

        // Find dropdown toggle button
        const toggleSelector = 'div[role="button"][aria-label="Image"]';
        log(`[Diagnostics] Querying toggle button with selector: "${toggleSelector}"`);
        let modeButton = document.querySelector(toggleSelector);
        
        if (!modeButton) {
            log(`[Diagnostics] Selector "${toggleSelector}" failed. Trying fallback "div#_r_7d_[role="button"]"...`);
            modeButton = document.querySelector('div#_r_7d_[role="button"]');
        }

        if (!modeButton) {
            log('[Diagnostics] ✗ ERROR: Could not find mode toggle button on screen.', 'error');
            log('--- END DIAGNOSTICS: ensureVideoMode() ---');
            return false;
        }

        log('[Diagnostics] Toggle button located. Simulating click...');
        try {
            modeButton.click();
            log('[Diagnostics] Toggle button click event dispatched successfully.');
            // Execute popover DOM diagnostics
            await inspectDropdownDOM();
        } catch (clickErr) {
            log(`[Diagnostics] ✗ ERROR: Clicking toggle button threw exception: ${clickErr.message}`, 'error');
            log('--- END DIAGNOSTICS: ensureVideoMode() ---');
            return false;
        }

        log('[Diagnostics] Waiting 500ms for dropdown rendering...');
        await sleep(500);

        // Find Video option in dropdown
        log('[Diagnostics] Searching for Video option in dropdown menu...');
        const videoOption = await findVideoOption();
        if (!videoOption) {
            log('[Diagnostics] ✗ ERROR: Video option not found in dropdown.', 'error');
            log('--- END DIAGNOSTICS: ensureVideoMode() ---');
            return false;
        }

        log('[Diagnostics] Video option located. Simulating click...');
        try {
            videoOption.click();
            log('[Diagnostics] Video option click event dispatched successfully.');
        } catch (clickErr) {
            log(`[Diagnostics] ✗ ERROR: Clicking video option threw exception: ${clickErr.message}`, 'error');
            log('--- END DIAGNOSTICS: ensureVideoMode() ---');
            return false;
        }

        log('[Diagnostics] Waiting 500ms for mode change to complete...');
        await sleep(500);

        const newMode = await getCurrentMode();
        log(`[Diagnostics] Final detected mode: "${newMode}"`);
        
        if (newMode === 'Video') {
            log('✓ [Diagnostics] Successfully switched to Video mode.');
            log('--- END DIAGNOSTICS: ensureVideoMode() ---');
            return true;
        } else {
            log(`[Diagnostics] ✗ ERROR: Final mode check failed. Expected "Video" but detected "${newMode}"`, 'error');
            log('--- END DIAGNOSTICS: ensureVideoMode() ---');
            return false;
        }
    }

    log(`[Diagnostics] ✗ ERROR: Unknown mode encountered: "${currentMode}"`, 'error');
    log('--- END DIAGNOSTICS: ensureVideoMode() ---');
    return false;
}

/**
 * Check if the Send/Animate button is enabled (glowing/active)
 * The button is enabled when aria-disabled is NOT 'true' and it doesn't have the disabled attribute
 */
function isSendButtonEnabled(btn) {
    if (!btn) return false;
    const ariaDisabled = btn.getAttribute('aria-disabled');
    const hasDisabledAttr = btn.hasAttribute('disabled');
    return ariaDisabled !== 'true' && !hasDisabledAttr;
}

/**
 * Wait for the Send/Animate button to become enabled (glowing)
 * Uses MutationObserver to detect when aria-disabled changes from 'true' to 'false'
 */
function waitForSendButtonEnabled() {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        // First check if button is already enabled
        const btn = findSendButton();
        if (btn && isSendButtonEnabled(btn)) {
            log('Send button is already enabled!');
            resolve(btn);
            return;
        }

        log('Waiting for Send button to become enabled (image upload processing)...');

        // Set up interval to check for button state
        const checkInterval = setInterval(() => {
            // Check for timeout
            if (Date.now() - startTime > CONFIG.BUTTON_ENABLE_TIMEOUT) {
                clearInterval(checkInterval);
                if (buttonObserver) {
                    buttonObserver.disconnect();
                }
                reject(new Error('Timeout waiting for Send button to enable (image upload may have failed)'));
                return;
            }

            // Check for stop signal
            if (shouldStop) {
                clearInterval(checkInterval);
                if (buttonObserver) {
                    buttonObserver.disconnect();
                }
                reject(new Error('Stopped by user'));
                return;
            }

            // Check button state
            const currentBtn = findSendButton();
            if (currentBtn && isSendButtonEnabled(currentBtn)) {
                clearInterval(checkInterval);
                if (buttonObserver) {
                    buttonObserver.disconnect();
                }
                log('Send button is now enabled! (aria-disabled changed)');
                resolve(currentBtn);
                return;
            }
        }, CONFIG.BUTTON_CHECK_INTERVAL);

        // Also use MutationObserver for faster detection
        let buttonObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                // Check if aria-disabled attribute changed
                if (mutation.type === 'attributes' && mutation.attributeName === 'aria-disabled') {
                    const currentBtn = findSendButton();
                    if (currentBtn && isSendButtonEnabled(currentBtn)) {
                        clearInterval(checkInterval);
                        buttonObserver.disconnect();
                        log('Send button enabled detected via MutationObserver!');
                        resolve(currentBtn);
                        return;
                    }
                }

                // Also check for any DOM changes that might add the enabled button
                if (mutation.type === 'childList') {
                    const currentBtn = findSendButton();
                    if (currentBtn && isSendButtonEnabled(currentBtn)) {
                        clearInterval(checkInterval);
                        buttonObserver.disconnect();
                        log('Send button enabled detected via DOM change!');
                        resolve(currentBtn);
                        return;
                    }
                }
            }
        });

        // Observe the document for attribute changes and child list changes
        buttonObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['aria-disabled'],
            childList: true,
            subtree: true
        });
    });
}

/**
 * Click the Send/Animate button
 * ONLY targets the Send button with aria-label="Send"
 * Waits for button to become enabled (glowing) before clicking
 */
async function clickAnimateButton() {
    log('Looking for Send/Animate button...');

    // ONLY use the Send button - do NOT use Create button
    // Wait for Send button to become enabled (glowing) after image upload
    log('Waiting for Send button to become enabled (image upload processing)...');

    sendToSidebar({
        type: 'PROGRESS_UPDATE',
        current: -1,
        total: -1,
        status: 'Waiting for button to glow...'
    });

    const btn = await waitForSendButtonEnabled();

    if (!btn) {
        throw new Error('Could not find Send/Animate button or it never became enabled');
    }

    // Double-check button is enabled before clicking
    if (btn.getAttribute('aria-disabled') === 'true') {
        log('Button still shows disabled, waiting more...');
        await waitForSendButtonEnabled();
    }

    // Small delay to ensure UI is fully ready
    await sleep(500);

    // Log button state before clicking
    const ariaDisabled = btn.getAttribute('aria-disabled');
    log(`Send button aria-disabled = "${ariaDisabled}" - clicking now!`);

    // Click the button
    btn.click();
    log('✓ Clicked Send/Animate button!');

    // Wait a moment for the click to register
    await sleep(500);

    return btn;
}

/**
 * ============================================================================
 * POST-GENERATION PIPELINE
 * ============================================================================
 * 
 * Flow (discovered from live Meta AI DOM, July 2026):
 *   click Create → wait for new gallery item → click Download on that item → done
 *
 * Gallery structure (live selectors):
 *   Gallery container:  div.grid.grid-cols-2
 *   Each media card:    div.group\/media-item
 *   Video card marker:  div[data-testid="generated-video"]
 *   View media link:    a[aria-label="View media"]
 *   Download button:    button[aria-label="Download"]  (on each card, visible on hover)
 *
 * The download button lives DIRECTLY on the gallery card — no viewer overlay needed.
 */

/**
 * Snapshot the current gallery items before clicking Create.
 * Returns a Set of href strings from a[aria-label="View media"] links,
 * which uniquely identify each generated media card (e.g. "/create/1111671202040182").
 */
function snapshotGalleryItems() {
    const links = document.querySelectorAll('a[aria-label="View media"]');
    const hrefs = new Set();
    links.forEach(a => hrefs.add(a.getAttribute('href')));
    log(`[Gallery] Snapshot captured: ${hrefs.size} existing items`);
    return hrefs;
}

/**
 * Wait until at least one NEW gallery item appears that was NOT in the snapshot.
 * Uses both polling and MutationObserver for fast detection.
 * Timeout: 5 minutes (video generation can be slow).
 * 
 * Returns the first new gallery card element (div.group/media-item), or null on timeout.
 */
async function waitForNewGalleryItem(snapshotHrefs) {
    const GENERATION_TIMEOUT = 300000; // 5 minutes
    const POLL_MS = 1000;
    const startTime = Date.now();

    log('[Gallery] Waiting for new gallery item to appear...');

    return new Promise((resolve, reject) => {
        const findNewItem = () => {
            const currentLinks = document.querySelectorAll('a[aria-label="View media"]');
            for (const link of currentLinks) {
                const href = link.getAttribute('href');
                if (href && !snapshotHrefs.has(href)) {
                    // Found a new item — walk up to find the card wrapper
                    const card = link.closest('.group\\/media-item') 
                              || link.closest('[data-testid="generated-video"]')?.parentElement?.parentElement
                              || link.parentElement;
                    log(`[Gallery] ✓ New media detected: ${href}`);
                    return card;
                }
            }
            return null;
        };

        // Immediate check (generation may already be done from prior runs)
        const immediate = findNewItem();
        if (immediate) {
            resolve(immediate);
            return;
        }

        const pollTimer = setInterval(() => {
            if (shouldStop) {
                clearInterval(pollTimer);
                if (currentObserver) { currentObserver.disconnect(); currentObserver = null; }
                reject(new Error('Stopped by user'));
                return;
            }

            if (Date.now() - startTime > GENERATION_TIMEOUT) {
                clearInterval(pollTimer);
                if (currentObserver) { currentObserver.disconnect(); currentObserver = null; }
                log('[Gallery] ⚠ Generation timeout (5 min) — proceeding without download', 'error');
                resolve(null);
                return;
            }

            const elapsed = Math.round((Date.now() - startTime) / 1000);
            if (elapsed % 10 === 0) {
                log(`[Gallery] Still waiting... ${elapsed}s elapsed`);
            }

            const newCard = findNewItem();
            if (newCard) {
                clearInterval(pollTimer);
                if (currentObserver) { currentObserver.disconnect(); currentObserver = null; }
                resolve(newCard);
            }
        }, POLL_MS);

        // MutationObserver for faster detection
        currentObserver = new MutationObserver(() => {
            const newCard = findNewItem();
            if (newCard) {
                clearInterval(pollTimer);
                currentObserver.disconnect();
                currentObserver = null;
                resolve(newCard);
            }
        });
        currentObserver.observe(document.body, { childList: true, subtree: true });
    });
}

/**
 * Find the Download button on a specific gallery card.
 * The live DOM shows: button[aria-label="Download"] inside the card overlay.
 * Falls back to broader selectors if the primary one isn't found.
 */
function findDownloadButtonOnCard(card) {
    // Primary: exact match from live DOM
    let btn = card.querySelector('button[aria-label="Download"]');
    if (btn) {
        log('[Download] ✓ Found button[aria-label="Download"] on card');
        return btn;
    }

    // Fallback: any element with download aria-label
    btn = card.querySelector('[aria-label="Download"]');
    if (btn) {
        log('[Download] ✓ Found [aria-label="Download"] on card (fallback)');
        return btn;
    }

    // Fallback: anchor with download attribute
    btn = card.querySelector('a[download]');
    if (btn) {
        log('[Download] ✓ Found a[download] on card (fallback)');
        return btn;
    }

    log('[Download] ✗ No download button found on this card', 'error');
    return null;
}

/**
 * Find download button anywhere on the page (global fallback).
 * Used when the card-level search fails.
 */
function findDownloadButton() {
    // Try the first gallery card's download button
    const firstCard = document.querySelector('.group\\/media-item');
    if (firstCard) {
        const btn = findDownloadButtonOnCard(firstCard);
        if (btn) return btn;
    }

    // Global fallback using CONFIG selectors
    const btn = document.querySelector(CONFIG.SELECTORS.downloadBtn);
    log(`[Download] Global fallback search: ${btn ? 'Found' : 'Not Found'}`);
    return btn;
}

/**
 * Click the download button and wait for the download to initiate.
 */
async function triggerDownload(downloadBtn) {
    if (!downloadBtn) {
        log('[Download] ✗ No download button provided — skipping', 'error');
        return false;
    }

    try {
        // Make the button visible (it's hidden until hover via CSS opacity)
        downloadBtn.style.opacity = '1';
        downloadBtn.style.pointerEvents = 'auto';
        downloadBtn.classList.remove('pointer-events-none');

        // Scroll into view
        downloadBtn.scrollIntoView({ block: 'center', behavior: 'instant' });
        await sleep(200);

        // Dispatch hover to trigger any JS-based visibility
        downloadBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        downloadBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await sleep(200);

        // Click
        downloadBtn.click();
        log('[Download] ✓ Download button clicked');

        // Wait for the download to register
        await sleep(2000);
        return true;
    } catch (err) {
        log(`[Download] ✗ Error clicking download button: ${err.message}`, 'error');
        return false;
    }
}

/**
 * Complete post-generation pipeline:
 *   1. Wait for new gallery item
 *   2. Find download button on that item
 *   3. Click download
 *   4. Return
 *
 * @param {Set} snapshotHrefs - gallery snapshot taken BEFORE clicking Create
 */
async function waitForGenerationAndDownload(snapshotHrefs) {
    // Step 1: Wait for new gallery item
    log('[Pipeline] Step 1/3: Waiting for new gallery item...');
    const newCard = await waitForNewGalleryItem(snapshotHrefs);

    if (!newCard) {
        log('[Pipeline] ⚠ No new gallery item detected — skipping download', 'error');
        return false;
    }

    // Diagnostics Phase: Enumerate elements and inspect card DOM
    log('[Diagnostics] Starting live DOM inspection on the newest generated gallery card...');
    try {
        // Hover over the card
        log('[Diagnostics] Hovering over the newest generated gallery card...');
        newCard.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        newCard.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await sleep(1000); // Let UI changes/transitions resolve

        // Enumerate every clickable element inside the card
        const clickables = newCard.querySelectorAll('button, a, [role="button"], [class*="cursor-pointer"]');
        log(`[Diagnostics] Total buttons/links/clickable elements found inside the card: ${clickables.length}`);

        let foundCandidateDownload = false;

        clickables.forEach((el, index) => {
            const tagName = el.tagName || 'none';
            const role = el.getAttribute('role') || 'none';
            const ariaLabel = el.getAttribute('aria-label') || 'none';
            const title = el.getAttribute('title') || 'none';
            const dataTestId = el.getAttribute('data-testid') || 'none';
            const className = el.className || 'none';
            const outerHTML = el.outerHTML || 'none';

            log(`[Diagnostics] Clickable Element #${index + 1}:`);
            log(`  - tagName: ${tagName}`);
            log(`  - role: ${role}`);
            log(`  - aria-label: ${ariaLabel}`);
            log(`  - title: ${title}`);
            log(`  - data-testid: ${dataTestId}`);
            log(`  - className: ${className}`);
            log(`  - outerHTML: ${outerHTML.substring(0, 400)}`);

            const isDownloadBtn = 
                ariaLabel.toLowerCase().includes('download') || 
                title.toLowerCase().includes('download') || 
                dataTestId.toLowerCase().includes('download') ||
                (tagName === 'A' && el.hasAttribute('download'));

            if (isDownloadBtn) {
                foundCandidateDownload = true;
                log(`  --> [Diagnostics] Candidate download button identified above!`);
            }
        });

        log(`[Diagnostics] Total candidate download buttons found: ${foundCandidateDownload ? 'At least one' : 'None'}`);
    } catch (diagError) {
        log(`[Diagnostics] Error during card inspection: ${diagError.message}`, 'error');
    }

    // Brief pause to let the card fully render (continuation of standard pipeline)
    await sleep(1500);
    log('[Pipeline] Step 2/3: Searching for download button on new card...');

    // Step 2: Find the download button using existing selectors
    let downloadBtn = findDownloadButtonOnCard(newCard);

    // If not found on card, try hovering to make it appear
    if (!downloadBtn) {
        log('[Pipeline] Download button not immediately visible, triggering hover...');
        newCard.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        newCard.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await sleep(500);
        downloadBtn = findDownloadButtonOnCard(newCard);
    }

    // Final fallback: global search
    if (!downloadBtn) {
        log('[Pipeline] Trying global download button search...');
        downloadBtn = findDownloadButton();
    }

    if (!downloadBtn) {
        log('[Pipeline] ⚠ Could not find download button anywhere — skipping', 'error');
        return false;
    }

    // Step 3: Click download
    log('[Pipeline] Step 3/3: Triggering download...');
    const downloaded = await triggerDownload(downloadBtn);
    log(`[Pipeline] Download ${downloaded ? 'succeeded ✓' : 'failed ✗'}`);
    return downloaded;
}

// ============================================================================
// MAIN AUTOMATION LOOP
// ============================================================================

/**
 * Process a single item (image + prompt)
 * 
 * Flow:
 * 1. Upload image (via clipboard paste)
 * 2. Set prompt text
 * 3. Wait for Send/Animate button to become enabled (glowing)
 * 4. Click the Send/Animate button
 * 5. Wait for video generation to complete
 * 6. Move to next item
 */
async function processItem(imageData, prompt, index, total) {
    log(`\n========================================`);
    log(`Processing item ${index + 1}/${total}`);
    log(`Image: ${imageData.name}`);
    log(`Prompt: ${prompt.substring(0, 50)}...`);
    log(`========================================\n`);

    // Step 0: Ensure we're ready (Unified UI vs Legacy UI)
    sendToSidebar({
        type: 'PROGRESS_UPDATE',
        current: index + 1,
        total: total,
        status: 'Checking readiness...'
    });

    if (isUnifiedInterface()) {
        log('Step 0: Waiting for Unified Create UI to be ready...');
        try {
            await waitForUnifiedCreateReady();
        } catch (e) {
            log('Warning: ' + e.message + ', proceeding anyway...', 'error');
        }
    } else {
        log('Step 0: Ensuring Video mode is active (Legacy UI)...');
        try {
            await waitForMetaReady();
        } catch (e) {
            log('Warning: ' + e.message + ', proceeding anyway...', 'error');
        }
        const modeOk = await ensureVideoMode();
        if (!modeOk) {
            log('Warning: Could not verify Video mode, proceeding anyway...', 'error');
        }
    }

    sendToSidebar({
        type: 'PROGRESS_UPDATE',
        current: index + 1,
        total: total,
        status: 'Uploading image...'
    });

    // Step 1: Upload image
    log('Step 1: Uploading image...');
    await uploadImage(imageData);
    log('✓ Image upload initiated');

    // Step 2: Set prompt (optional - some users may not want prompt)
    if (prompt && prompt.trim().length > 0) {
        log('Step 2: Setting prompt text...');
        await setPromptText(prompt);
        log('✓ Prompt set');
    }

    // Step 3: Wait for Send button to glow and click it
    log('Step 3: Waiting for Send/Animate button to become enabled...');
    sendToSidebar({
        type: 'PROGRESS_UPDATE',
        current: index + 1,
        total: total,
        status: 'Waiting for button to activate...'
    });

    await clickAnimateButton();
    log('✓ Animate button clicked');

    log('[Diagnostics] clickAnimateButton() returned. Automation is now completing the item.');
    log('[Diagnostics] Checking if video generation wait is bypassed...');
    log('[Diagnostics] Early return / Bypassing download pipeline: No calls to waitForVideoGeneration() or triggerDownload() are implemented in this legacy image path.');

    // NO WAITING: Immediately proceed to next image
    // Meta AI handles generation in background while we process next image

    // Mark item complete
    sendToSidebar({
        type: 'ITEM_COMPLETE',
        index: index
    });

    log(`✓ Item ${index + 1}/${total} completed!`);

    // Update storage
    await chrome.storage.local.set({ currentIndex: index + 1 });

    // Brief delay to let UI update before next upload
    await sleep(500);
}

/**
 * Process a single text prompt for Text-to-Video
 */
async function processTextItem(prompt, index, total) {
    log(`\n========================================`);
    log(`Processing text item ${index + 1}/${total}`);
    log(`Prompt: ${prompt.substring(0, 50)}...`);
    log(`========================================\n`);

    // Step 0: Ensure we're ready (Unified UI vs Legacy UI)
    sendToSidebar({
        type: 'PROGRESS_UPDATE',
        current: index + 1,
        total: total,
        status: 'Checking readiness...'
    });

    if (isUnifiedInterface()) {
        log('Step 0: Waiting for Unified Create UI to be ready...');
        try {
            await waitForUnifiedCreateReady();
        } catch (e) {
            log('Warning: ' + e.message + ', proceeding anyway...', 'error');
        }
    } else {
        log('Step 0: Ensuring Video mode is active (Legacy UI)...');
        try {
            await waitForMetaReady();
        } catch (e) {
            log('Warning: ' + e.message + ', proceeding anyway...', 'error');
        }
        const modeOk = await ensureVideoMode();
        if (!modeOk) {
            log('Warning: Could not verify Video mode, proceeding anyway...', 'error');
        }
    }

    // Step 1: Set prompt text
    if (prompt && prompt.trim().length > 0) {
        let finalPrompt = prompt;
        if (isUnifiedInterface()) {
            const trimmedPrompt = prompt.trim().toLowerCase();
            const alreadyRequestsVideo = trimmedPrompt.startsWith('create a video') || 
                                         trimmedPrompt.startsWith('create a cinematic video') || 
                                         trimmedPrompt.startsWith('animate') ||
                                         trimmedPrompt.startsWith('video of');
            if (!alreadyRequestsVideo) {
                finalPrompt = CONFIG.VIDEO_PREFIX + prompt;
                log(`Transformed prompt for unified video generation: "${finalPrompt}"`);
            }
        }
        log('Step 1: Setting prompt text...');
        await setPromptText(finalPrompt);
        log('✓ Prompt set');
    } else {
        throw new Error('Prompt cannot be empty for text-to-video mode');
    }

    // Step 2: Snapshot gallery BEFORE clicking Create
    log('Step 2: Taking gallery snapshot before Create...');
    const gallerySnapshot = snapshotGalleryItems();

    // Step 3: Wait for Send button to activate and click it
    log('Step 3: Waiting for Create button to become enabled...');
    sendToSidebar({
        type: 'PROGRESS_UPDATE',
        current: index + 1,
        total: total,
        status: 'Clicking Create...'
    });

    await clickAnimateButton();
    log('✓ Create button clicked');

    // Step 4: Wait for generation + download
    log('Step 4: Waiting for generation and downloading...');
    sendToSidebar({
        type: 'PROGRESS_UPDATE',
        current: index + 1,
        total: total,
        status: 'Generating... waiting for result'
    });

    const downloaded = await waitForGenerationAndDownload(gallerySnapshot);
    
    if (downloaded) {
        log('✓ Download completed successfully');
    } else {
        log('⚠ Download was not completed (timeout or button not found)', 'error');
    }

    // Mark item complete
    sendToSidebar({
        type: 'ITEM_COMPLETE',
        index: index
    });

    log(`✓ Item ${index + 1}/${total} completed!`);

    // Update storage
    await chrome.storage.local.set({ currentIndex: index + 1 });

    // Brief delay to let UI update
    await sleep(500);
}

/**
 * Request image data from sidebar on-demand (lazy loading)
 * This prevents memory exhaustion when handling 30+ images
 */
async function requestImageData(index) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { type: 'GET_IMAGE_DATA', index: index },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error('Could not get image from sidebar: ' + chrome.runtime.lastError.message));
                } else if (response && response.success) {
                    resolve(response.imageData);
                } else {
                    reject(new Error(response?.error || 'Failed to get image data'));
                }
            }
        );
    });
}

/**
 * Main automation runner - uses lazy loading for images
 * Images are fetched one-at-a-time from sidebar to prevent memory exhaustion
 */
async function runAutomation() {
    if (isRunning) {
        log('Automation already running');
        return;
    }

    isRunning = true;
    shouldStop = false;

    try {
        // Get queue metadata from storage (NOT full image data)
        const state = await chrome.storage.local.get(['queueMeta', 'prompts', 'currentIndex', 'totalItems']);

        // Determine if this is a text-only workflow (no image queue exists but prompts do)
        const isTextOnly = (!state.queueMeta || state.queueMeta.length === 0) && (state.prompts && state.prompts.length > 0);

        // Support both old format (queue) and new format (queueMeta) for backwards compatibility
        const totalItems = state.totalItems || (isTextOnly ? state.prompts.length : (state.queueMeta?.length || 0));

        if (!state.prompts || totalItems === 0) {
            throw new Error('No queue found in storage');
        }

        const prompts = state.prompts;
        const startIndex = state.currentIndex || 0;

        log(`Starting automation from index ${startIndex}, total items: ${totalItems}`);
        if (isTextOnly) {
            log(`Running text-only automation mode`);
        } else {
            log(`Using lazy loading - images will be fetched one at a time`);
        }

        // Process each item sequentially
        for (let i = startIndex; i < totalItems; i++) {
            if (shouldStop) {
                log('Automation stopped by user');
                sendToSidebar({ type: 'AUTOMATION_STOPPED' });
                break;
            }

            try {
                if (isTextOnly) {
                    sendToSidebar({
                        type: 'PROGRESS_UPDATE',
                        current: i + 1,
                        total: totalItems,
                        status: 'Processing text prompt...'
                    });

                    await processTextItem(prompts[i], i, totalItems);
                } else {
                    // LAZY LOADING: Request image data from sidebar for this specific index
                    log(`Requesting image ${i + 1}/${totalItems} from sidebar...`);

                    sendToSidebar({
                        type: 'PROGRESS_UPDATE',
                        current: i + 1,
                        total: totalItems,
                        status: 'Loading image...'
                    });

                    const imageData = await requestImageData(i);

                    if (!imageData) {
                        throw new Error('Failed to load image data from sidebar');
                    }

                    log(`Image ${i + 1} loaded successfully (${imageData.name})`);

                    await processItem(imageData, prompts[i], i, totalItems);
                }
            } catch (error) {
                log(`Error processing item ${i + 1}: ${error.message}`, 'error');
                sendToSidebar({
                    type: 'ITEM_ERROR',
                    index: i,
                    error: error.message
                });

                // Skip to next item
                await chrome.storage.local.set({ currentIndex: i + 1 });

                // Brief pause before continuing on error
                await sleep(1000);
            }
        }

        // Automation complete
        if (!shouldStop) {
            log('Automation complete!');
            sendToSidebar({ type: 'AUTOMATION_COMPLETE' });
            await chrome.storage.local.set({ isRunning: false, currentIndex: 0 });
        }

    } catch (error) {
        log(`Automation error: ${error.message}`, 'error');
        sendToSidebar({
            type: 'ITEM_ERROR',
            index: -1,
            error: error.message
        });
    } finally {
        isRunning = false;
        shouldStop = false;
    }
}

/**
 * Stop the automation
 */
function stopAutomation() {
    log('Stop requested');
    shouldStop = true;

    if (currentObserver) {
        currentObserver.disconnect();
        currentObserver = null;
    }
}

// ============================================================================
// MESSAGE LISTENER
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'START_AUTOMATION':
            console.log('[Diagnostics] window.location.href after START_AUTOMATION received:', window.location.href);
            log(`[Diagnostics] window.location.href after START_AUTOMATION received: ${window.location.href}`, 'info');
            runAutomation();
            sendResponse({ success: true });
            break;

        case 'STOP_AUTOMATION':
            stopAutomation();
            sendResponse({ success: true });
            break;

        default:
            sendResponse({ success: false, error: 'Unknown message type' });
    }

    return true; // Keep channel open for async response
});

// ============================================================================
// AUTO-RESUME ON PAGE LOAD
// ============================================================================

(async function checkAndResume() {
    const state = await chrome.storage.local.get(['isRunning', 'currentIndex']);

    if (state.isRunning && state.currentIndex > 0) {
        log('Detected interrupted automation, resuming...');
        await sleep(2000); // Wait for page to fully load
        runAutomation();
    }
})();

/**
 * Diagnostic function to help debug element detection
 */
async function runDiagnostics() {
    log('Running diagnostics...');

    // Check for prompt input elements
    log('Checking for prompt input elements:');
    for (const selector of CONFIG.SELECTORS.promptInputSelectors) {
        const el = document.querySelector(selector);
        if (el) {
            log(`  ✓ FOUND: ${selector}`);
        }
    }

    // Log all contenteditable elements
    const editables = document.querySelectorAll('[contenteditable="true"]');
    log(`Found ${editables.length} contenteditable element(s)`);
    editables.forEach((el, i) => {
        const attrs = [];
        if (el.getAttribute('aria-label')) attrs.push(`aria-label="${el.getAttribute('aria-label')}"`);
        if (el.getAttribute('role')) attrs.push(`role="${el.getAttribute('role')}"`);
        if (el.getAttribute('data-lexical-editor')) attrs.push('data-lexical-editor');
        if (el.className) attrs.push(`class="${el.className.substring(0, 50)}"`);
        log(`  [${i}] ${el.tagName} - ${attrs.join(', ')}`);
    });

    // Check for Add Media button
    log('Checking for Add Media button:');
    for (const selector of CONFIG.SELECTORS.addMediaBtnSelectors) {
        const el = document.querySelector(selector);
        if (el) {
            log(`  ✓ FOUND: ${selector}`);
        }
    }

    // Check for Create/Send buttons
    log('Checking for Create/Send buttons:');
    for (const selector of [...CONFIG.SELECTORS.createBtnSelectors, ...CONFIG.SELECTORS.sendBtnSelectors]) {
        const el = document.querySelector(selector);
        if (el) {
            log(`  ✓ FOUND: ${selector}`);
        }
    }
}

log('Content script loaded on ' + window.location.href);

// Run diagnostics after page fully loads
setTimeout(runDiagnostics, 2000);

// Readiness monitoring
(function monitorReadiness() {
    const startTime = Date.now();
    const navigationStart = (performance.timing && performance.timing.navigationStart) ? performance.timing.navigationStart : startTime;
    
    function logEvent(name) {
        const absolute = Date.now();
        const relative = absolute - navigationStart;
        console.log(`[Readiness Tracker] ${name} detected at absolute: ${absolute}ms (relative: +${relative}ms)`);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => logEvent('DOMContentLoaded'));
    } else {
        logEvent('DOMContentLoaded (already fired)');
    }

    if (document.readyState !== 'complete') {
        window.addEventListener('load', () => logEvent('window.load'));
    } else {
        logEvent('window.load (already fired)');
    }

    const found = {
        firstContenteditable: false,
        promptTextbox: false,
        createBtn: false,
        videoBtn: false,
        imageBtn: false
    };

    const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed > 15000) { // Stop monitoring after 15 seconds
            clearInterval(interval);
            return;
        }

        // 1. First contenteditable element
        if (!found.firstContenteditable) {
            const el = document.querySelector('[contenteditable="true"]');
            if (el) {
                logEvent('first contenteditable element');
                found.firstContenteditable = true;
            }
        }

        // 2. Prompt textbox
        if (!found.promptTextbox) {
            for (const selector of CONFIG.SELECTORS.promptInputSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                    logEvent(`prompt textbox (via "${selector}")`);
                    found.promptTextbox = true;
                    break;
                }
            }
        }

        // 3. Create button
        if (!found.createBtn) {
            for (const selector of CONFIG.SELECTORS.createBtnSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                    logEvent(`Create button (via "${selector}")`);
                    found.createBtn = true;
                    break;
                }
            }
        }

        // 4. Video button
        if (!found.videoBtn) {
            const el = document.querySelector('div[role="button"][aria-label="Video"]');
            if (el) {
                logEvent('Video button');
                found.videoBtn = true;
            }
        }

        // 5. Image button
        if (!found.imageBtn) {
            const el = document.querySelector('div[role="button"][aria-label="Image"]');
            if (el) {
                logEvent('Image button');
                found.imageBtn = true;
            }
        }

        // If everything is found, we can stop
        if (found.firstContenteditable && found.promptTextbox && found.createBtn && (found.videoBtn || found.imageBtn)) {
            logEvent('All core interactive elements detected');
            clearInterval(interval);
        }
    }, 50); // check every 50ms
})();
