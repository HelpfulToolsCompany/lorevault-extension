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

// Show limit warning banner (storage or daily limit)
function showLimitWarning(errorMessage = '') {
    const isStorageLimit = errorMessage.toLowerCase().includes('storage');

    const bannerText = isStorageLimit
        ? 'Storage limit reached! Memory storage paused. Existing memories still work.'
        : 'Daily limit reached! Memory storage paused. Existing memories still work.';

    const toastText = isStorageLimit
        ? 'Storage limit reached. Upgrade to Pro for more storage.'
        : 'Daily extraction limit reached. Upgrade to Pro for unlimited memory storage.';

    // Show persistent warning in settings panel
    const warningHtml = `
        <div class="lorevault-rate-limit-banner" id="lorevault-rate-limit-banner">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span>${bannerText}</span>
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

    // Show SillyTavern toast notification (more visible)
    if (typeof toastr !== 'undefined') {
        toastr.warning(
            toastText,
            'LoreVault',
            { timeOut: 10000, extendedTimeOut: 15000, preventDuplicates: true }
        );
    }

    // Update the appropriate bar based on limit type
    if (isStorageLimit) {
        // Update storage bar to show limit reached
        const storageFill = $('#lorevault-storage-fill');
        storageFill.css('width', '100%').removeClass('warning').addClass('danger');
    } else {
        // Update the daily usage bar to show limit reached
        const dailyUsageFill = $('#lorevault-daily-usage-fill');
        const dailyUsageHint = $('#lorevault-daily-usage-hint');
        const dailyUsageHintText = $('#lorevault-daily-usage-hint-text');

        dailyUsageFill.css('width', '100%').removeClass('warning').addClass('danger');
        dailyUsageHint.show().addClass('limit-reached');
        dailyUsageHintText.text('Limit reached! Upgrade to Pro for unlimited extractions.');
    }
}

// Backward compatible alias
function showRateLimitWarning(errorMessage = '') {
    showLimitWarning(errorMessage);
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

// Update daily usage bar
function updateDailyUsageBar(usage) {
    const dailyUsageContainer = $('#lorevault-daily-usage');
    const dailyUsageFill = $('#lorevault-daily-usage-fill');
    const dailyUsageText = $('#lorevault-daily-usage-text');
    const dailyUsageHint = $('#lorevault-daily-usage-hint');
    const dailyUsageHintText = $('#lorevault-daily-usage-hint-text');

    // Hide for pro users (unlimited)
    if (usage.tier !== 'free' || usage.summarizations_limit === -1) {
        dailyUsageContainer.hide();
        return;
    }

    dailyUsageContainer.show();

    const used = usage.summarizations_today || 0;
    const limit = usage.summarizations_limit || 50;
    const percent = Math.min(100, Math.round((used / limit) * 100));

    // Update text and bar
    dailyUsageText.text(`${used} / ${limit}`);
    dailyUsageFill.css('width', `${percent}%`);

    // Update bar color based on usage
    dailyUsageFill.removeClass('warning danger');
    if (percent >= 100) {
        dailyUsageFill.addClass('danger');
    } else if (percent >= 80) {
        dailyUsageFill.addClass('warning');
    }

    // Show hint based on usage level
    dailyUsageHint.removeClass('limit-reached');
    if (percent >= 100) {
        dailyUsageHint.show().addClass('limit-reached');
        dailyUsageHintText.text('Limit reached! Upgrade to Pro for unlimited extractions.');
    } else if (percent >= 80) {
        dailyUsageHint.show();
        dailyUsageHintText.text(`Only ${limit - used} left today. Upgrade to Pro for unlimited.`);
    } else {
        dailyUsageHint.hide();
    }
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

        // Show/hide upgrade button based on tier (only show for free users)
        // Show manage subscription button for pro users
        if (usage.tier === 'free') {
            $('#lorevault-upgrade-btn').show();
            $('#lorevault-manage-subscription-btn').hide();
        } else {
            $('#lorevault-upgrade-btn').hide();
            $('#lorevault-manage-subscription-btn').show();
        }

        // Update daily usage bar (free tier only)
        updateDailyUsageBar(usage);

        setConnectionStatus('connected', `Connected (${usage.tier})`);
        return true;
    } catch (error) {
        console.error('LoreVault connection test failed:', error);
        setConnectionStatus('disconnected', error.message);

        // If API key is invalid, clear it and show registration form
        if (error.message.includes('Invalid API key') || error.message.includes('401')) {
            console.log('LoreVault: Invalid API key detected, clearing settings');
            extension_settings[extensionName].apiKey = '';
            saveSettings();
            updateUIState();
            showMessage('error', 'Your API key is invalid. Please register again.');
        }

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
    // For group chats, use groupId if available
    const prefix = context.groupId || context.characterId || 'unknown';
    return `${prefix}_${context.chatId}`;
}

// Get current character name (for backward compatibility - use getSpeakerName for individual messages)
function getCurrentCharacterName() {
    const context = getContext();
    return context.name2 || context.characterId || 'Character';
}

// Get speaker name from a message (handles group chats)
function getSpeakerName(msg, context) {
    if (msg.is_user) {
        return context.name1 || 'User';
    }
    // In group chats, msg.name contains the character name
    // In regular chats, msg.name might be undefined, fall back to context.name2
    return msg.name || context.name2 || context.characterId || 'Character';
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

// Get active characters from recent messages (handles group chats)
function getActiveCharacters() {
    const context = getContext();
    const chat = context.chat || [];
    const characters = new Set();

    // Collect speakers from recent messages (last 20)
    const recentMessages = chat.slice(-20);
    for (const msg of recentMessages) {
        const speaker = getSpeakerName(msg, context);
        if (speaker) {
            characters.add(speaker);
        }
    }

    // Fallback: if no messages yet, add context characters
    if (characters.size === 0) {
        if (context.name2) characters.add(context.name2);
        if (context.name1) characters.add(context.name1);
        // For group chats, add group members if available
        if (context.groups && context.groupId) {
            const group = context.groups.find(g => g.id === context.groupId);
            if (group && group.members) {
                group.members.forEach(member => characters.add(member.name || member));
            }
        }
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

        // Handle limit reached (402) - could be daily or storage limit
        if (response.status === 402) {
            const errorData = await response.json().catch(() => ({ error: 'Limit reached' }));
            if (!rateLimitWarningShown) {
                rateLimitWarningShown = true;
                showRateLimitWarning(errorData.error || '');
            }
            console.warn('LoreVault: Limit reached -', errorData.error);
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

        // Handle limit reached (402) - could be daily or storage limit
        if (response.status === 402) {
            const errorData = await response.json().catch(() => ({ error: 'Limit reached' }));
            if (!rateLimitWarningShown) {
                rateLimitWarningShown = true;
                showRateLimitWarning(errorData.error || '');
            }
            console.warn('LoreVault: Limit reached -', errorData.error);
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

// Open Stripe billing portal for subscription management
async function openBillingPortal() {
    try {
        const result = await apiCall('billing-portal', 'POST', {
            return_url: window.location.href
        });
        if (result.url) {
            window.open(result.url, '_blank');
        }
    } catch (error) {
        console.error('LoreVault billing portal failed:', error);
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
        // Convert all messages to v1.1 format
        // Use getSpeakerName to handle group chats correctly
        const messages = chat.map((msg, index) => ({
            message_id: index + 1,
            role: msg.is_user ? 'user' : 'assistant',
            content: msg.mes || '',
            speaker: getSpeakerName(msg, context),
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

            // Handle limit reached during import
            if (response.status === 402) {
                const errorData = await response.json().catch(() => ({ error: 'Limit reached' }));
                const isStorage = (errorData.error || '').toLowerCase().includes('storage');
                showRateLimitWarning(errorData.error || '');
                showMessage('warning', `Import stopped at ${processed} messages. ${isStorage ? 'Storage' : 'Daily'} limit reached.`);
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

// Memory browser state
let memoryBrowserState = {
    currentPage: 0,
    pageSize: 20,
    total: 0,
    chatFilter: '',
    typeFilter: '',
    chatOptions: [],
    typeOptions: [],
};

// Fetch and display memories
async function loadMemories(resetPage = false) {
    if (resetPage) {
        memoryBrowserState.currentPage = 0;
    }

    const memoriesList = $('#lorevault-memories-list');
    const refreshBtn = $('#lorevault-refresh-memories-btn');
    const pagination = $('#lorevault-memory-pagination');

    refreshBtn.addClass('spinning');
    memoriesList.html('<div class="lorevault-memories-loading">Loading memories...</div>');

    try {
        const offset = memoryBrowserState.currentPage * memoryBrowserState.pageSize;
        let url = `memories?limit=${memoryBrowserState.pageSize}&offset=${offset}`;

        if (memoryBrowserState.chatFilter) {
            url += `&chat_id=${encodeURIComponent(memoryBrowserState.chatFilter)}`;
        }
        if (memoryBrowserState.typeFilter) {
            url += `&event_type=${encodeURIComponent(memoryBrowserState.typeFilter)}`;
        }

        const result = await apiCall(url);

        memoryBrowserState.total = result.total;
        memoryBrowserState.typeOptions = result.event_types || [];

        // Update type filter options
        const typeSelect = $('#lorevault-memory-type-filter');
        const currentTypeValue = typeSelect.val();
        typeSelect.html('<option value="">All Types</option>');
        for (const type of memoryBrowserState.typeOptions) {
            typeSelect.append(`<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`);
        }
        typeSelect.val(currentTypeValue);

        if (!result.memories || result.memories.length === 0) {
            memoriesList.html('<div class="lorevault-no-memories">No memories found</div>');
            pagination.hide();
            return;
        }

        // Render memories
        let html = '';
        for (const memory of result.memories) {
            const dateStr = new Date(memory.created_at).toLocaleDateString();
            const typeClass = memory.event_type ? memory.event_type.toLowerCase() : '';
            const chatIdShort = memory.chat_id.length > 20
                ? memory.chat_id.substring(0, 20) + '...'
                : memory.chat_id;

            html += `
                <div class="lorevault-memory-item" data-memory-id="${escapeHtml(memory.id)}">
                    <div class="lorevault-memory-header">
                        <span class="lorevault-memory-type ${escapeHtml(typeClass)}">${escapeHtml(memory.event_type || 'event')}</span>
                        <button class="lorevault-memory-delete-btn" title="Delete this memory">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                    <div class="lorevault-memory-summary">${escapeHtml(memory.summary)}</div>
                    <div class="lorevault-memory-meta">
                        <span class="lorevault-memory-meta-item" title="${escapeHtml(memory.chat_id)}">
                            <i class="fa-solid fa-comments"></i> ${escapeHtml(chatIdShort)}
                        </span>
                        <span class="lorevault-memory-meta-item">
                            <i class="fa-solid fa-calendar"></i> ${dateStr}
                        </span>
                        ${memory.location ? `<span class="lorevault-memory-meta-item"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(memory.location)}</span>` : ''}
                    </div>
                    ${memory.characters_involved && memory.characters_involved.length > 0 ? `
                        <div class="lorevault-memory-characters">
                            ${memory.characters_involved.map(c => `<span class="lorevault-character-tag">${escapeHtml(c)}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }

        memoriesList.html(html);

        // Attach delete handlers
        memoriesList.find('.lorevault-memory-delete-btn').on('click', async function() {
            const memoryItem = $(this).closest('.lorevault-memory-item');
            const memoryId = memoryItem.data('memory-id');
            await deleteMemory(memoryId, memoryItem);
        });

        // Update pagination
        const totalPages = Math.ceil(memoryBrowserState.total / memoryBrowserState.pageSize);
        if (totalPages > 1) {
            $('#lorevault-memories-page-info').text(`Page ${memoryBrowserState.currentPage + 1} of ${totalPages}`);
            $('#lorevault-memories-prev').prop('disabled', memoryBrowserState.currentPage === 0);
            $('#lorevault-memories-next').prop('disabled', memoryBrowserState.currentPage >= totalPages - 1);
            pagination.show();
        } else {
            pagination.hide();
        }

    } catch (error) {
        console.error('LoreVault load memories failed:', error);
        memoriesList.html('<div class="lorevault-memories-loading">Failed to load memories</div>');
    } finally {
        refreshBtn.removeClass('spinning');
    }
}

// Delete a single memory
async function deleteMemory(memoryId, memoryItem) {
    const confirmed = confirm('Delete this memory?\n\nThis cannot be undone.');

    if (!confirmed) return;

    try {
        const settings = getSettings();
        const response = await fetch(`${settings.apiBase}/memories`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'x-api-key': settings.apiKey,
            },
            body: JSON.stringify({ memory_id: memoryId }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Deletion failed' }));
            throw new Error(error.error);
        }

        const result = await response.json();

        // Remove from UI with animation
        memoryItem.fadeOut(300, function() {
            $(this).remove();

            // Update total and check if we need to reload
            memoryBrowserState.total--;
            if ($('.lorevault-memory-item').length === 0 && memoryBrowserState.currentPage > 0) {
                memoryBrowserState.currentPage--;
                loadMemories();
            } else if ($('.lorevault-memory-item').length === 0) {
                $('#lorevault-memories-list').html('<div class="lorevault-no-memories">No memories found</div>');
                $('#lorevault-memory-pagination').hide();
            }
        });

        showMessage('success', `Memory deleted. Freed ${formatBytes(result.storage_freed_bytes)}.`);
        await testConnection(); // Refresh stats

    } catch (error) {
        console.error('LoreVault delete memory failed:', error);
        showMessage('error', error.message);
    }
}

// Populate chat filter dropdown from stored chats
async function populateChatFilter() {
    try {
        const result = await apiCall('chats');
        const chatSelect = $('#lorevault-memory-chat-filter');
        chatSelect.html('<option value="">All Chats</option>');

        if (result.chats && result.chats.length > 0) {
            for (const chat of result.chats) {
                const chatIdShort = chat.chat_id.length > 25
                    ? chat.chat_id.substring(0, 25) + '...'
                    : chat.chat_id;
                chatSelect.append(`<option value="${escapeHtml(chat.chat_id)}">${escapeHtml(chatIdShort)}</option>`);
            }
        }
    } catch (error) {
        console.error('Failed to populate chat filter:', error);
    }
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
            speaker: getSpeakerName(latestMessage, context),
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
            speaker: getSpeakerName(latestMessage, context),
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

    $('#lorevault-manage-subscription-btn').on('click', async () => {
        await openBillingPortal();
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

    // Memory browser handlers
    $('#lorevault-refresh-memories-btn').on('click', async () => {
        await populateChatFilter();
        await loadMemories(true);
    });

    $('#lorevault-memory-chat-filter').on('change', function() {
        memoryBrowserState.chatFilter = $(this).val();
        loadMemories(true);
    });

    $('#lorevault-memory-type-filter').on('change', function() {
        memoryBrowserState.typeFilter = $(this).val();
        loadMemories(true);
    });

    $('#lorevault-memories-prev').on('click', () => {
        if (memoryBrowserState.currentPage > 0) {
            memoryBrowserState.currentPage--;
            loadMemories();
        }
    });

    $('#lorevault-memories-next').on('click', () => {
        const totalPages = Math.ceil(memoryBrowserState.total / memoryBrowserState.pageSize);
        if (memoryBrowserState.currentPage < totalPages - 1) {
            memoryBrowserState.currentPage++;
            loadMemories();
        }
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
