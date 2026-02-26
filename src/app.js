import { isSetupComplete, showSetupOverlay, initSettingsOverlay } from './setup.js';
import { initFirebase } from './firebase.js';
import { initCapture, resetToIdle } from './capture.js';
import { initHistory, refreshHistory } from './history.js';
import { initHealth, refreshHealth, resetHealthToIdle } from './health.js';
import { initDashboard, refreshDashboard } from './dashboard.js';
import { initActivityCalendar, refreshActivityCalendar } from './activity.js';
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
    initHealth();
    initDashboard();
    initActivityCalendar();
    initNavigation();
});

// --- Screen Navigation -------------------------------------------------

const screens = new Map(); // id → element
let activeScreenId = 'screen-home';

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
            navigateTo(target);
        });
    }

    // Wire up cross-screen quick actions.
    for (const btn of document.querySelectorAll('[data-target-screen]')) {
        btn.addEventListener('click', () => {
            const target = btn.dataset.targetScreen;
            if (!target || target === activeScreenId) return;
            navigateTo(target);
        });
    }

    navigateTo(activeScreenId);
}

function navigateTo(screenId) {
    switchScreen(screenId);
    const tabs = document.querySelectorAll('.nav-tab');
    const activeTab = [...tabs].find((tab) => tab.dataset.screen === screenId) || null;
    setActiveTab(tabs, activeTab);
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
    if (screenId === 'screen-health') {
        refreshHealth();
    }
    if (screenId === 'screen-dashboard') {
        refreshDashboard();
    }
    if (screenId === 'screen-activity-calendar') {
        refreshActivityCalendar();
    }

    // Reset capture state when leaving log screen
    if (screenId !== 'screen-log') {
        resetToIdle();
    }
    if (screenId !== 'screen-health') {
        resetHealthToIdle();
    }
}

function setActiveTab(allTabs, active) {
    for (const tab of allTabs) {
        tab.classList.toggle('active', tab === active);
    }
}
