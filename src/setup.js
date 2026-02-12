import { STORAGE_KEYS } from './config.js';
import { show, hide } from './utils.js';

// --- Public API --------------------------------------------------------

/**
 * Returns true if both username and API key are stored.
 */
export function isSetupComplete() {
    return Boolean(getUsername() && getApiKey());
}

export function getUsername() {
    return localStorage.getItem(STORAGE_KEYS.username) || '';
}

export function getApiKey() {
    return localStorage.getItem(STORAGE_KEYS.apiKey) || '';
}

/**
 * Show the first-time setup overlay. Resolves when user completes setup.
 */
export function showSetupOverlay() {
    return new Promise((resolve) => {
        const overlay = document.getElementById('setup-overlay');
        const usernameInput = document.getElementById('setup-username');
        const apiKeyInput = document.getElementById('setup-api-key');
        const errorEl = document.getElementById('setup-error');
        const saveBtn = document.getElementById('setup-save-btn');

        usernameInput.value = getUsername();
        apiKeyInput.value = getApiKey();
        hide(errorEl);
        show(overlay);

        function onSave() {
            const username = usernameInput.value.trim();
            const apiKey = apiKeyInput.value.trim();

            if (!username) {
                showError(errorEl, 'Please enter a username.');
                return;
            }
            if (!apiKey || !apiKey.startsWith('sk-')) {
                showError(errorEl, 'Please enter a valid OpenAI API key (starts with sk-).');
                return;
            }

            localStorage.setItem(STORAGE_KEYS.username, username);
            localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
            hide(overlay);
            saveBtn.removeEventListener('click', onSave);
            resolve();
        }

        saveBtn.addEventListener('click', onSave);
    });
}

/**
 * Wire up the settings overlay (change username / key after initial setup).
 */
export function initSettingsOverlay() {
    const overlay = document.getElementById('settings-overlay');
    const usernameInput = document.getElementById('settings-username');
    const apiKeyInput = document.getElementById('settings-api-key');
    const errorEl = document.getElementById('settings-error');
    const saveBtn = document.getElementById('settings-save-btn');
    const cancelBtn = document.getElementById('settings-cancel-btn');
    const openBtn = document.getElementById('settings-btn');

    openBtn.addEventListener('click', () => {
        usernameInput.value = getUsername();
        apiKeyInput.value = getApiKey();
        hide(errorEl);
        show(overlay);
    });

    cancelBtn.addEventListener('click', () => {
        hide(overlay);
    });

    saveBtn.addEventListener('click', () => {
        const username = usernameInput.value.trim();
        const apiKey = apiKeyInput.value.trim();

        if (!username) {
            showError(errorEl, 'Username is required.');
            return;
        }
        if (!apiKey || !apiKey.startsWith('sk-')) {
            showError(errorEl, 'Enter a valid API key (starts with sk-).');
            return;
        }

        localStorage.setItem(STORAGE_KEYS.username, username);
        localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
        hide(overlay);
    });
}

// --- Helpers -----------------------------------------------------------

function showError(el, message) {
    el.textContent = message;
    show(el);
}
