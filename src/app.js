import { isSetupComplete, showSetupOverlay, initSettingsOverlay } from './setup.js';
import { initFirebase } from './firebase.js';
import { initCapture, resetToIdle } from './capture.js';
import { initHistory, refreshHistory } from './history.js';
import { show, hide } from './utils.js';

// --- Boot --------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    // Show setup overlay if first launch
    if (!isSetupComplete()) {
        await showSetupOverlay();
    }

    // Init subsystems
    initFirebase();
    initSettingsOverlay();
    initCapture();
    initHistory();
    initNavigation();
});

// --- Screen Navigation -------------------------------------------------

const screens = new Map(); // id → element
let activeScreenId = 'screen-log';

function initNavigation() {
    // Cache screen elements
    for (const el of document.querySelectorAll('.screen')) {
        screens.set(el.id, el);
    }

    // Wire up bottom nav tabs
    const tabs = document.querySelectorAll('.nav-tab');
    for (const tab of tabs) {
        tab.addEventListener('click', () => {
            const target = tab.dataset.screen;
            if (target === activeScreenId) return;
            switchScreen(target);
            setActiveTab(tabs, tab);
        });
    }
}

function switchScreen(screenId) {
    // Hide current
    const current = screens.get(activeScreenId);
    if (current) hide(current);

    // Show target
    const target = screens.get(screenId);
    if (target) show(target);

    activeScreenId = screenId;

    // Trigger data refresh when entering history
    if (screenId === 'screen-history') {
        refreshHistory();
    }

    // Reset capture state when leaving log screen
    if (screenId !== 'screen-log') {
        resetToIdle();
    }
}

function setActiveTab(allTabs, active) {
    for (const tab of allTabs) {
        tab.classList.toggle('active', tab === active);
    }
}
