import { eventSource, event_types, saveSettingsDebounced, Generate, stopGeneration, chat, saveChatConditional, showSwipeButtons } from '../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../extensions.js';
import { delay } from '../../utils.js';

const extensionName = 'prewarm';
const extensionFolderPath = `scripts/extensions/${extensionName}`;

// Prewarm modes
const PREWARM_MODES = {
    QUIET: 'quiet',      // Uses quiet generation (AI continue style)
    USER_MSG: 'user_msg', // Simulates user sending a message
};

// Default settings
const defaultSettings = {
    enabled: false,
    delay: 500, // ms to wait before canceling the prewarm request
    mode: PREWARM_MODES.USER_MSG, // Default to user message mode
    prewarmMessage: '.', // Message to use for user_msg mode (single dot is minimal)
};

// Flag to prevent recursive prewarm triggers
let isPrewarming = false;

// Track the last generation type to skip prewarm after swipes/regenerates
let lastGenerationType = null;

// Generation types that should NOT trigger prewarm
const SKIP_PREWARM_TYPES = ['swipe', 'regenerate', 'continue', 'quiet'];

/**
 * Handles the GENERATION_STARTED event to track generation type.
 * @param {string} type The type of generation
 */
function onGenerationStarted(type) {
    // Don't track our own prewarm generations
    if (isPrewarming) {
        return;
    }
    lastGenerationType = type;
    console.debug('[Prewarm] Generation started, type:', type);
}

/**
 * Performs the context prewarm by sending and immediately canceling a generation.
 * This causes the endpoint to cache the conversation context without generating new tokens.
 */
async function doPrewarm() {
    if (!extension_settings[extensionName]?.enabled) {
        return;
    }

    if (isPrewarming) {
        console.debug('[Prewarm] Already prewarming, skipping');
        return;
    }

    isPrewarming = true;
    const mode = extension_settings[extensionName]?.mode || defaultSettings.mode;
    console.log(`[Prewarm] Starting context prewarm (mode: ${mode})...`);

    try {
        // Small delay to let the UI settle after generation completes
        await delay(100);

        const prewarmDelay = extension_settings[extensionName]?.delay || defaultSettings.delay;

        if (mode === PREWARM_MODES.USER_MSG) {
            // User message mode: Inject a temporary user message into chat array
            // This is invisible - no DOM changes, no save
            const prewarmMessage = extension_settings[extensionName]?.prewarmMessage || defaultSettings.prewarmMessage;
            
            // Create a temporary user message object
            const tempUserMessage = {
                name: 'User',
                is_user: true,
                is_system: false,
                send_date: new Date().toISOString(),
                mes: prewarmMessage,
                extra: {
                    isPrewarm: true, // Mark so we can identify it
                },
            };
            
            // Add to chat array (but not to DOM)
            chat.push(tempUserMessage);
            console.debug('[Prewarm] Added temporary user message to chat array');
            
            // Set up a timeout to cancel the generation after delay
            const cancelTimeout = setTimeout(() => {
                console.debug('[Prewarm] Canceling generation after delay');
                stopGeneration();
            }, prewarmDelay);
            
            // Start quiet generation and wait for it to complete/fail
            try {
                await Generate('quiet', {
                    quiet_prompt: '', // Empty quiet prompt, the user message is in chat array
                    force_name2: true,
                    skipWIAN: true,
                });
            } catch (error) {
                // Expected - we cancelled it
                if (error?.name !== 'AbortError' && !String(error).includes('abort')) {
                    console.debug('[Prewarm] Generation ended (expected):', error?.message || error);
                }
            } finally {
                clearTimeout(cancelTimeout);
            }

            // Wait for any pending save operations to complete
            await delay(200);

            // Remove the temporary message from chat array
            // Find and remove our prewarm message (should be last, but search to be safe)
            for (let i = chat.length - 1; i >= 0; i--) {
                if (chat[i]?.extra?.isPrewarm) {
                    chat.splice(i, 1);
                    console.debug('[Prewarm] Removed temporary user message from chat array at index', i);
                    break;
                }
            }
            
            // Save chat to persist the removal
            await saveChatConditional();
            console.debug('[Prewarm] Saved chat after cleanup');
            
            // Refresh swipe buttons since the last message changed
            showSwipeButtons();

        } else {
            // Quiet mode: Use quiet generation (no user message added)
            const generatePromise = Generate('quiet', {
                quiet_prompt: '',
                force_name2: true,
                skipWIAN: true,
            }).catch((error) => {
                if (error?.name !== 'AbortError' && !String(error).includes('abort')) {
                    console.debug('[Prewarm] Generation ended (expected):', error?.message || error);
                }
            });

            // Wait for the context to be sent to the endpoint
            await delay(prewarmDelay);

            // Cancel the generation
            stopGeneration();
        }

        console.log('[Prewarm] Context prewarm complete - KV cache should be warm');

    } catch (error) {
        console.warn('[Prewarm] Error during prewarm:', error);
        // Make sure we clean up any temp message on error
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i]?.extra?.isPrewarm) {
                chat.splice(i, 1);
                console.debug('[Prewarm] Cleaned up prewarm message on error at index', i);
                break;
            }
        }
        // Save to persist the cleanup
        await saveChatConditional();
        // Refresh swipe buttons
        showSwipeButtons();
    } finally {
        // Small delay before allowing another prewarm
        await delay(200);
        isPrewarming = false;
    }
}

/**
 * Handles the GENERATION_ENDED event.
 * @param {number} messageId The ID of the generated message
 */
function onGenerationEnded(messageId) {
    // Don't trigger prewarm if we're currently prewarming (prevents infinite loop)
    if (isPrewarming) {
        return;
    }

    // Skip prewarm for certain generation types (swipe, regenerate, continue, quiet)
    if (lastGenerationType && SKIP_PREWARM_TYPES.includes(lastGenerationType)) {
        console.debug('[Prewarm] Skipping prewarm for generation type:', lastGenerationType);
        lastGenerationType = null;
        return;
    }
    
    lastGenerationType = null;

    // Use setTimeout to not block the event handler
    setTimeout(() => doPrewarm(), 0);
}

/**
 * Loads the extension settings from storage.
 */
function loadSettings() {
    // Initialize settings if they don't exist
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }

    // Apply defaults for any missing settings
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = value;
        }
    }

    // Update UI elements
    $('#prewarm_enabled').prop('checked', extension_settings[extensionName].enabled);
    $('#prewarm_delay').val(extension_settings[extensionName].delay);
    $('#prewarm_mode').val(extension_settings[extensionName].mode);
    $('#prewarm_message').val(extension_settings[extensionName].prewarmMessage);
    
    // Show/hide message input based on mode
    updateMessageInputVisibility();
}

/**
 * Updates the visibility of the message input based on selected mode.
 */
function updateMessageInputVisibility() {
    const mode = extension_settings[extensionName]?.mode || defaultSettings.mode;
    if (mode === PREWARM_MODES.USER_MSG) {
        $('#prewarm_message_container').show();
    } else {
        $('#prewarm_message_container').hide();
    }
}

/**
 * Initializes the extension.
 */
(async function init() {
    // Load the settings HTML template
    const settingsHtml = await renderExtensionTemplateAsync(extensionName, 'settings');
    $('#extensions_settings').append(settingsHtml);

    // Load settings after HTML is added
    loadSettings();

    // Bind event handlers for settings UI
    $('#prewarm_enabled').on('change', function () {
        extension_settings[extensionName].enabled = $(this).prop('checked');
        saveSettingsDebounced();
        console.log('[Prewarm] Enabled:', extension_settings[extensionName].enabled);
    });

    $('#prewarm_delay').on('input', function () {
        const value = parseInt(String($(this).val()), 10);
        if (!isNaN(value) && value >= 100 && value <= 5000) {
            extension_settings[extensionName].delay = value;
            saveSettingsDebounced();
        }
    });

    $('#prewarm_mode').on('change', function () {
        extension_settings[extensionName].mode = $(this).val();
        saveSettingsDebounced();
        updateMessageInputVisibility();
        console.log('[Prewarm] Mode:', extension_settings[extensionName].mode);
    });

    $('#prewarm_message').on('input', function () {
        extension_settings[extensionName].prewarmMessage = String($(this).val()) || defaultSettings.prewarmMessage;
        saveSettingsDebounced();
    });

    // Subscribe to generation events
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);

    console.log('[Prewarm] Context Prewarm extension loaded');
})();
