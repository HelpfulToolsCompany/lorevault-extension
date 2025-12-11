// LoreVault Extension for SillyTavern
// Provides automatic memory management and context retrieval for RP conversations

import { extension_settings, getContext, loadExtensionSettings } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types, setExtensionPrompt, extension_prompt_types } from '../../../../script.js';

// Extension name for settings storage
const extensionName = 'lorevault';
// Get the folder path dynamically from this script's location
const extensionFolderPath = new URL('.', import.meta.url).pathname.slice(1);

// Default settings
const defaultSettings = {
    apiKey: '',
    enabled: true,
    tokenBudget: 1000,
    apiBase: 'https://ukkkdooyoerpgwpctkqi.supabase.co/functions/v1',
};

// Supabase anon key (public, safe to expose)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVra2tkb295b2VycGd3cGN0a3FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5MTA0MzIsImV4cCI6MjA4MDQ4NjQzMn0.Q08-3CaAht1Ppmhjm0rP5Ss_7WE2Wd62DNTCMTxJEs4';

// Current session stats
let sessionStats = {
    tokensSaved: 0,
    messagesSent: 0,
};

// Track rate limit warnings (don't spam user)
let rateLimitWarningShown = false;

// Load settings from SillyTavern storage
async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }

    // Update UI with loaded settings
    $('#lorevault-api-key').val(extension_settings[extensionName].apiKey || '');
    $('#lorevault-enabled').prop('checked', extension_settings[extensionName].enabled);
    $('#lorevault-token-budget').val(extension_settings[extensionName].tokenBudget || 1000);
    $('#lorevault-token-budget-value').text(extension_settings[extensionName].tokenBudget || 1000);

    // Show/hide sections based on API key
    updateUIState();

    // Test connection if API key exists
    if (extension_settings[extensionName].apiKey) {
        await testConnection();
    }
}

// Save settings
function saveSettings() {
    saveSettingsDebounced();
}

// Get current settings
function getSettings() {
    return extension_settings[extensionName] || defaultSettings;
}

// Update UI based on connection state
function updateUIState() {
    const settings = getSettings();
    const hasApiKey = !!settings.apiKey;

    if (hasApiKey) {
        $('#lorevault-register-section').hide();
        $('#lorevault-connected-section').show();
        $('#lorevault-api-key').val(settings.apiKey);
    } else {
        $('#lorevault-register-section').show();
        $('#lorevault-connected-section').hide();
    }
}

// Set connection status indicator
function setConnectionStatus(status, message) {
    const indicator = $('#lorevault-status-indicator');
    const text = $('#lorevault-status-text');

    indicator.removeClass('connected disconnected loading');

    switch (status) {
        case 'connected':
            indicator.addClass('connected');
            text.text(message || 'Connected');
            break;
        case 'disconnected':
            indicator.addClass('disconnected');
            text.text(message || 'Disconnected');
            break;
        case 'loading':
            indicator.addClass('loading');
            text.text(message || 'Connecting...');
            break;
    }
}

// Show message in UI
function showMessage(type, message) {
    const messageArea = $('#lorevault-message-area');
    messageArea.html(`<div class="lorevault-message ${type}">${message}</div>`);
    setTimeout(() => messageArea.html(''), 5000);
}

// Show rate limit warning banner
function showRateLimitWarning() {
    // Show persistent warning in settings panel
    const warningHtml = `
        <div class="lorevault-rate-limit-banner" id="lorevault-rate-limit-banner">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span>Daily limit reached! Memory storage paused. Existing memories still work.</span>
            <button class="lorevault-banner-close" onclick="this.parentElement.remove()">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `;

    // Insert at top of connected section
    const connectedSection = $('#lorevault-connected-section');
    if (connectedSection.length && !$('#lorevault-rate-limit-banner').length) {
        connectedSection.prepend(warningHtml);
    }

    // Also show a toast notification
    showMessage('warning', 'Daily event limit reached. New memories won\'t be stored until tomorrow.');
}

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format number with K/M suffix
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

// API call helper
async function apiCall(endpoint, method = 'GET', body = null) {
    const settings = getSettings();
    if (!settings.apiKey) {
        throw new Error('No API key configured');
    }

    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'x-api-key': settings.apiKey,
        },
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(`${settings.apiBase}/${endpoint}`, options);

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
}

// Test connection and fetch usage stats
async function testConnection() {
    setConnectionStatus('loading', 'Testing connection...');

    try {
        const usage = await apiCall('usage');

        // Update tier badge
        const tierBadge = $('#lorevault-tier-badge');
        tierBadge.removeClass('free pro premium').addClass(usage.tier);
        tierBadge.text(usage.tier.toUpperCase());

        // Update storage bar
        const storagePercent = usage.storage_percent || 0;
        const storageFill = $('#lorevault-storage-fill');
        storageFill.css('width', `${storagePercent}%`);
        storageFill.removeClass('warning danger');
        if (storagePercent > 90) storageFill.addClass('danger');
        else if (storagePercent > 70) storageFill.addClass('warning');

        $('#lorevault-storage-text').text(
            `${formatBytes(usage.storage_used_bytes)} / ${formatBytes(usage.storage_limit_bytes)}`
        );

        // Update stats
        $('#lorevault-events-count').text(formatNumber(usage.total_events));
        $('#lorevault-tokens-saved').text(formatNumber(usage.tokens_saved_estimate));
        $('#lorevault-messages-count').text(formatNumber(usage.total_messages_processed));
        $('#lorevault-chats-count').text(usage.chats);

        // Show/hide beta notice based on tier (upgrade button hidden during beta)
        if (usage.tier === 'free') {
            $('#lorevault-beta-notice').show();
        } else {
            $('#lorevault-beta-notice').hide();
        }

        setConnectionStatus('connected', `Connected (${usage.tier})`);
        return true;
    } catch (error) {
        console.error('LoreVault connection test failed:', error);
        setConnectionStatus('disconnected', error.message);
        return false;
    }
}

// Register new user
async function registerUser(email) {
    const settings = getSettings();

    try {
        const response = await fetch(`${settings.apiBase}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({ email }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Registration failed' }));
            throw new Error(error.error);
        }

        const data = await response.json();

        // Save API key
        extension_settings[extensionName].apiKey = data.api_key;
        saveSettings();

        // Update UI
        updateUIState();
        await testConnection();

        if (data.existing_user) {
            showMessage('info', 'Welcome back! Your existing API key has been restored.');
        } else {
            showMessage('success', 'Registration successful! LoreVault is now active.');
        }
    } catch (error) {
        console.error('LoreVault registration failed:', error);
        showMessage('error', error.message);
    }
}

// Get current chat ID
function getCurrentChatId() {
    const context = getContext();
    if (!context.chatId) return null;
    return `${context.characterId || 'unknown'}_${context.chatId}`;
}

// Get current character name
function getCurrentCharacterName() {
    const context = getContext();
    return context.name2 || context.characterId || 'Character';
}

// Get recent messages as a single context string for v1.1 API
// Truncates to 4500 chars to stay within API limit (5000)
function getRecentContext(count = 5) {
    const context = getContext();
    const chat = context.chat || [];
    const combined = chat.slice(-count).map(msg => msg.mes || '').join('\n\n');
    return combined.slice(0, 4500);
}

// Get current message ID (chat length)
function getCurrentMessageId() {
    const context = getContext();
    const chat = context.chat || [];
    return chat.length;
}

// Get active characters from recent messages
function getActiveCharacters() {
    const context = getContext();
    const characterName = getCurrentCharacterName();
    const characters = new Set([characterName]);

    // Also add "You" or the user persona name
    if (context.name1) {
        characters.add(context.name1);
    }

    return Array.from(characters);
}

// Ingest messages to LoreVault (v1.1 API format)
async function ingestMessages(messages) {
    const settings = getSettings();
    if (!settings.enabled || !settings.apiKey) return;

    const chatId = getCurrentChatId();
    if (!chatId) return;

    try {
        const response = await fetch(`${settings.apiBase}/ingest`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'x-api-key': settings.apiKey,
            },
            body: JSON.stringify({
                chat_id: chatId,
                messages: messages,
            }),
        });

        // Handle rate limit (402)
        if (response.status === 402) {
            if (!rateLimitWarningShown) {
                rateLimitWarningShown = true;
                showRateLimitWarning();
            }
            console.warn('LoreVault: Daily limit reached');
            return;
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        const result = await response.json();
        sessionStats.messagesSent += messages.length;

        if (result.events_created > 0) {
            console.log(`LoreVault: ${result.events_created} event(s) created, ${result.messages_stored} message(s) stored`);
        }

        return result;
    } catch (error) {
        console.error('LoreVault ingest failed:', error);
    }
}

// Retrieve context from LoreVault (v1.1 API format)
async function retrieveContext() {
    const settings = getSettings();
    if (!settings.enabled || !settings.apiKey) return null;

    const chatId = getCurrentChatId();
    if (!chatId) return null;

    try {
        const response = await fetch(`${settings.apiBase}/retrieve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'x-api-key': settings.apiKey,
            },
            body: JSON.stringify({
                chat_id: chatId,
                current_context: getRecentContext(5),
                current_characters: getActiveCharacters(),
                current_message_id: getCurrentMessageId(),
            }),
        });

        // Handle rate limit (402) - user hit daily limit
        if (response.status === 402) {
            if (!rateLimitWarningShown) {
                rateLimitWarningShown = true;
                showRateLimitWarning();
            }
            console.warn('LoreVault: Daily limit reached - memory retrieval paused');
            return null;
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        const result = await response.json();
        return result.context;
    } catch (error) {
        console.error('LoreVault retrieve failed:', error);
        return null;
    }
}

// Open upgrade checkout
async function openUpgrade() {
    try {
        const result = await apiCall('checkout', 'POST', { tier: 'pro' });
        if (result.checkout_url) {
            window.open(result.checkout_url, '_blank');
        }
    } catch (error) {
        console.error('LoreVault checkout failed:', error);
        showMessage('error', error.message);
    }
}

// Delete current chat memory
async function deleteCurrentChat() {
    const chatId = getCurrentChatId();
    if (!chatId) {
        showMessage('error', 'No chat selected. Open a chat first.');
        return;
    }

    const confirmed = confirm(
        'Delete memory for the current chat?\n\n' +
        'This will remove all stored events and character data for this chat only.\n\n' +
        'Your other chats will not be affected.'
    );

    if (!confirmed) return;

    try {
        const settings = getSettings();
        const response = await fetch(`${settings.apiBase}/delete`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'x-api-key': settings.apiKey,
            },
            body: JSON.stringify({ chat_id: chatId }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Deletion failed' }));
            throw new Error(error.error);
        }

        const result = await response.json();
        showMessage('success', `Chat memory deleted. Freed ${formatBytes(result.storage_freed_bytes)}.`);
        await testConnection(); // Refresh stats
    } catch (error) {
        console.error('LoreVault delete chat failed:', error);
        showMessage('error', error.message);
    }
}

// Import current chat history
async function importCurrentChat() {
    const settings = getSettings();
    if (!settings.enabled || !settings.apiKey) {
        showMessage('error', 'LoreVault is not enabled or configured');
        return;
    }

    const chatId = getCurrentChatId();
    if (!chatId) {
        showMessage('error', 'No chat selected. Open a chat first.');
        return;
    }

    const context = getContext();
    const chat = context.chat || [];

    if (chat.length === 0) {
        showMessage('error', 'Current chat is empty.');
        return;
    }

    const confirmed = confirm(
        `Import ${chat.length} messages from the current chat?\n\n` +
        'This will process the entire chat history and extract events, characters, and relationships.\n\n' +
        'This may take a moment for long chats.'
    );

    if (!confirmed) return;

    // Show progress UI
    $('#lorevault-import-btn').prop('disabled', true);
    $('#lorevault-import-progress').show();
    $('#lorevault-import-fill').css('width', '0%');

    try {
        const characterName = getCurrentCharacterName();
        const userName = context.name1 || 'User';

        // Convert all messages to v1.1 format
        const messages = chat.map((msg, index) => ({
            message_id: index + 1,
            role: msg.is_user ? 'user' : 'assistant',
            content: msg.mes || '',
            speaker: msg.is_user ? userName : characterName,
        }));

        // Send in batches of 20 to avoid overwhelming the API
        const batchSize = 20;
        let processed = 0;

        for (let i = 0; i < messages.length; i += batchSize) {
            const batch = messages.slice(i, i + batchSize);

            const response = await fetch(`${settings.apiBase}/ingest`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                    'x-api-key': settings.apiKey,
                },
                body: JSON.stringify({
                    chat_id: chatId,
                    messages: batch,
                }),
            });

            // Handle rate limit during import
            if (response.status === 402) {
                showRateLimitWarning();
                showMessage('warning', `Import stopped at ${processed} messages. Daily limit reached.`);
                break;
            }

            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            processed += batch.length;
            const percent = Math.round((processed / messages.length) * 100);

            $('#lorevault-import-count').text(processed);
            $('#lorevault-import-fill').css('width', `${percent}%`);
        }

        showMessage('success', `Imported ${messages.length} messages successfully!`);
        await testConnection(); // Refresh stats
    } catch (error) {
        console.error('LoreVault import failed:', error);
        showMessage('error', `Import failed: ${error.message}`);
    } finally {
        $('#lorevault-import-btn').prop('disabled', false);
        $('#lorevault-import-progress').hide();
    }
}

// Fetch and display stored chats list
async function loadStoredChats() {
    const chatsList = $('#lorevault-chats-list');
    const refreshBtn = $('#lorevault-refresh-chats-btn');

    refreshBtn.addClass('spinning');
    chatsList.html('<div class="lorevault-chats-loading">Loading...</div>');

    try {
        const result = await apiCall('chats');

        if (!result.chats || result.chats.length === 0) {
            chatsList.html('<div class="lorevault-no-chats">No stored chats</div>');
            return;
        }

        // Render chat list
        let html = '';
        for (const chat of result.chats) {
            const chatIdDisplay = chat.chat_id.length > 30
                ? chat.chat_id.substring(0, 30) + '...'
                : chat.chat_id;
            const lastUpdated = new Date(chat.last_updated).toLocaleDateString();

            html += `
                <div class="lorevault-chat-item" data-chat-id="${escapeHtml(chat.chat_id)}">
                    <div class="lorevault-chat-info">
                        <div class="lorevault-chat-id" title="${escapeHtml(chat.chat_id)}">${escapeHtml(chatIdDisplay)}</div>
                        <div class="lorevault-chat-stats">${chat.event_count} events, ${chat.message_count} msgs - ${lastUpdated}</div>
                    </div>
                    <button class="lorevault-chat-delete-btn" title="Delete this chat's memory">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;
        }

        chatsList.html(html);

        // Attach delete handlers
        chatsList.find('.lorevault-chat-delete-btn').on('click', async function() {
            const chatItem = $(this).closest('.lorevault-chat-item');
            const chatId = chatItem.data('chat-id');
            await deleteChatById(chatId, chatItem);
        });

    } catch (error) {
        console.error('LoreVault load chats failed:', error);
        chatsList.html('<div class="lorevault-chats-loading">Failed to load chats</div>');
    } finally {
        refreshBtn.removeClass('spinning');
    }
}

// Helper to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Delete a specific chat by ID
async function deleteChatById(chatId, chatItem) {
    const confirmed = confirm(
        `Delete memory for chat "${chatId}"?\n\n` +
        'This will remove all stored events and character data for this chat.'
    );

    if (!confirmed) return;

    try {
        const settings = getSettings();
        const response = await fetch(`${settings.apiBase}/delete`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'x-api-key': settings.apiKey,
            },
            body: JSON.stringify({ chat_id: chatId }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Deletion failed' }));
            throw new Error(error.error);
        }

        const result = await response.json();

        // Remove from UI
        chatItem.fadeOut(300, function() {
            $(this).remove();

            // Check if list is now empty
            if ($('.lorevault-chat-item').length === 0) {
                $('#lorevault-chats-list').html('<div class="lorevault-no-chats">No stored chats</div>');
            }
        });

        showMessage('success', `Chat memory deleted. Freed ${formatBytes(result.storage_freed_bytes)}.`);
        await testConnection(); // Refresh stats
    } catch (error) {
        console.error('LoreVault delete chat failed:', error);
        showMessage('error', error.message);
    }
}

// Delete all user data
async function deleteAllData() {
    const confirmed = confirm(
        'Are you sure you want to delete ALL your LoreVault data?\n\n' +
        'This will permanently delete:\n' +
        '- All stored events and summaries\n' +
        '- All character and relationship data\n' +
        '- All chat memory\n\n' +
        'This action cannot be undone!'
    );

    if (!confirmed) return;

    // Double confirmation for safety
    const doubleConfirmed = confirm(
        'This is your last chance to cancel.\n\n' +
        'Type "DELETE" in the next prompt to confirm.'
    );

    if (!doubleConfirmed) return;

    const typed = prompt('Type DELETE to confirm:');
    if (typed !== 'DELETE') {
        showMessage('info', 'Deletion cancelled.');
        return;
    }

    try {
        const settings = getSettings();
        const response = await fetch(`${settings.apiBase}/delete`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'x-api-key': settings.apiKey,
            },
            body: JSON.stringify({ delete_all: true }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Deletion failed' }));
            throw new Error(error.error);
        }

        showMessage('success', 'All your data has been deleted.');
        await testConnection(); // Refresh stats to show 0
    } catch (error) {
        console.error('LoreVault delete failed:', error);
        showMessage('error', error.message);
    }
}

// Hook into SillyTavern message events
function setupMessageHooks() {
    // Hook into message sent event (user messages)
    eventSource.on(event_types.MESSAGE_SENT, async (messageId) => {
        const context = getContext();
        const chat = context.chat || [];

        if (chat.length === 0) return;

        // Get the latest message
        const latestMessage = chat[chat.length - 1];
        if (!latestMessage) return;

        // Create message object for ingestion (v1.1 format)
        const message = {
            message_id: chat.length,
            role: latestMessage.is_user ? 'user' : 'assistant',
            content: latestMessage.mes || '',
            speaker: latestMessage.is_user ? (context.name1 || 'User') : getCurrentCharacterName(),
        };

        // Ingest the message
        await ingestMessages([message]);
    });

    // Hook into message received event (assistant messages)
    eventSource.on(event_types.MESSAGE_RECEIVED, async (messageId) => {
        const context = getContext();
        const chat = context.chat || [];

        if (chat.length === 0) return;

        // Get the latest message
        const latestMessage = chat[chat.length - 1];
        if (!latestMessage || latestMessage.is_user) return;

        // Create message object for ingestion (v1.1 format)
        const message = {
            message_id: chat.length,
            role: 'assistant',
            content: latestMessage.mes || '',
            speaker: getCurrentCharacterName(),
        };

        // Ingest the message
        await ingestMessages([message]);
    });

    // Hook into generation started event for context injection
    eventSource.on(event_types.GENERATION_STARTED, async () => {
        const settings = getSettings();
        if (!settings.enabled || !settings.apiKey) return;

        try {
            const context = await retrieveContext();
            if (context && context.trim().length > 0) {
                // Inject context directly into the prompt using ST's extension prompt API
                setExtensionPrompt(
                    'lorevault',                          // unique identifier
                    context,                              // our [STORY MEMORY] block
                    extension_prompt_types.IN_PROMPT,     // inject into main prompt
                    0                                     // priority/depth
                );

                console.log('LoreVault: Context injected into prompt');
            }
        } catch (error) {
            console.error('LoreVault context retrieval failed:', error);
        }
    });
}

// Initialize extension
jQuery(async () => {
    // Load settings HTML
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $('#extensions_settings').append(settingsHtml);

    // Load settings
    await loadSettings();

    // Setup event handlers
    $('#lorevault-register-btn').on('click', async () => {
        const email = $('#lorevault-email').val().trim();
        if (!email) {
            showMessage('error', 'Please enter your email address');
            return;
        }
        const agreedToTerms = $('#lorevault-agree-terms').is(':checked');
        if (!agreedToTerms) {
            showMessage('error', 'Please agree to the Terms of Service and Privacy Policy');
            return;
        }
        await registerUser(email);
    });

    $('#lorevault-copy-btn').on('click', () => {
        const apiKey = $('#lorevault-api-key').val();
        navigator.clipboard.writeText(apiKey).then(() => {
            showMessage('success', 'API key copied to clipboard');
        });
    });

    $('#lorevault-enabled').on('change', function () {
        extension_settings[extensionName].enabled = $(this).prop('checked');
        saveSettings();
    });

    $('#lorevault-token-budget').on('input', function () {
        const value = $(this).val();
        $('#lorevault-token-budget-value').text(value);
        extension_settings[extensionName].tokenBudget = parseInt(value);
        saveSettings();
    });

    $('#lorevault-test-btn').on('click', async () => {
        await testConnection();
    });

    $('#lorevault-refresh-btn').on('click', async () => {
        await testConnection();
    });

    $('#lorevault-upgrade-btn').on('click', async () => {
        await openUpgrade();
    });

    $('#lorevault-delete-chat-btn').on('click', async () => {
        await deleteCurrentChat();
    });

    $('#lorevault-delete-all-btn').on('click', async () => {
        await deleteAllData();
    });

    $('#lorevault-import-btn').on('click', async () => {
        await importCurrentChat();
    });

    $('#lorevault-refresh-chats-btn').on('click', async () => {
        await loadStoredChats();
    });

    // Setup drawer toggle
    $('#lorevault-settings .inline-drawer-header').on('click', function () {
        const icon = $(this).find('.inline-drawer-icon');
        const content = $(this).next('.inline-drawer-content');
        content.slideToggle();
        icon.toggleClass('down up');
    });

    // Setup message hooks
    setupMessageHooks();

    console.log('LoreVault extension loaded');
});

// Export for potential use by other extensions
export {
    retrieveContext,
    ingestMessages,
    getCurrentChatId,
    getSettings,
};
