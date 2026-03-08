import { queryActivities, queryStretches, queryWorkouts, saveActivity } from './firebase.js';
import { STORAGE_KEYS } from './config.js';
import { getActivityColor } from './activity-colors.js';
import { machineTypeColor, machineTypeLabel, normalizeMachineType } from './machineType.js';
import { refreshDashboard } from './dashboard.js';

const CALENDAR_DAYS = 28;
const RECENT_LIMIT = 20;
const NEW_ACTIVITY_VALUE = '__new__';

let gridEl, emptyEl;
let overlayEl, dateInput, selectInput, newNameRow, newNameInput, errorEl, saveBtn, cancelBtn;
let saveDefaultText = 'Save Activity';

export function initActivityCalendar() {
    gridEl = document.getElementById('activity-calendar-grid');
    emptyEl = document.getElementById('activity-calendar-empty');
    overlayEl = document.getElementById('activity-overlay');
    dateInput = document.getElementById('activity-date');
    selectInput = document.getElementById('activity-select');
    newNameRow = document.getElementById('activity-new-name-row');
    newNameInput = document.getElementById('activity-new-name');
    errorEl = document.getElementById('activity-error');
    saveBtn = document.getElementById('activity-save-btn');
    cancelBtn = document.getElementById('activity-cancel-btn');
    if (!gridEl) return;

    saveDefaultText = saveBtn?.textContent || saveDefaultText;
    gridEl.addEventListener('click', onDayClick);
    selectInput?.addEventListener('change', onSelectChanged);
    saveBtn?.addEventListener('click', onSave);
    cancelBtn?.addEventListener('click', closeOverlay);
}

export async function refreshActivityCalendar() {
    if (!gridEl) return;
    const since = getWindowStart(CALENDAR_DAYS);
    try {
        const [workouts, activities, stretches] = await Promise.all([
            queryWorkouts(since),
            queryActivities(since),
            queryStretches(since),
        ]);
        const recent = mergeRecentWithKnown(getRecentActivityNames(), activities);
        saveRecentActivityNames(recent);
        renderCalendar(workouts, activities, stretches);
        hideError();
        setEmptyState(workouts.length === 0 && activities.length === 0);
    } catch (err) {
        console.error('Failed to load activity calendar:', err);
        renderCalendar([], [], []);
        setEmptyState(true);
    }
}

export function getRecentActivityNames() {
    const raw = localStorage.getItem(STORAGE_KEYS.activityRecentNames);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return dedupeRecent(parsed);
    } catch {
        return [];
    }
}

export function pushRecentActivityName(name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return [];
    const existing = getRecentActivityNames().filter((item) => !sameActivityName(item, cleanName));
    const next = [cleanName, ...existing].slice(0, RECENT_LIMIT);
    saveRecentActivityNames(next);
    return next;
}

function saveRecentActivityNames(names) {
    localStorage.setItem(
        STORAGE_KEYS.activityRecentNames,
        JSON.stringify(dedupeRecent(names).slice(0, RECENT_LIMIT)),
    );
}

function mergeRecentWithKnown(recent, activities) {
    const ordered = [];
    const seen = new Set();
    for (const item of recent || []) {
        const clean = String(item || '').trim();
        const key = clean.toLowerCase();
        if (!clean || seen.has(key)) continue;
        seen.add(key);
        ordered.push(clean);
    }
    for (const activity of activities || []) {
        const clean = String(activity.activityName || '').trim();
        const key = clean.toLowerCase();
        if (!clean || seen.has(key)) continue;
        seen.add(key);
        ordered.push(clean);
    }
    return ordered.slice(0, RECENT_LIMIT);
}

function renderCalendar(workouts, activities, stretches) {
    const workoutTypesByDay = workoutTypesForDay(workouts);
    const activityNamesByDay = activityNamesForDay(activities);
    const stretchDays = stretchCompletionDays(stretches);
    const days = buildDayWindow(CALENDAR_DAYS);
    gridEl.innerHTML = days.map((date) => dayCellHTML(date, workoutTypesByDay, activityNamesByDay, stretchDays)).join('');
}

function dayCellHTML(date, workoutTypesByDay, activityNamesByDay, stretchDays) {
    const key = toDayKey(date);
    const workoutTypes = workoutTypesByDay.get(key) || [];
    const activityNames = activityNamesByDay.get(key) || [];
    const workoutMarkers = workoutTypes.slice(0, 3).map((type) => (
        `<span class="calendar-marker" style="background:${machineTypeColor(type)}" title="${machineTypeLabel(type)}"></span>`
    )).join('');
    const activityMarkers = activityNames.slice(0, 4).map((name) => (
        `<span class="calendar-marker" style="background:${getActivityColor(name)}" title="${escapeHtml(name)}"></span>`
    )).join('');
    const hasStretch = stretchDays.has(key);
    const stretchMarker = hasStretch
        ? '<span class="calendar-marker calendar-marker-stretch" title="Stretching"></span>'
        : '';
    const hasAny = workoutTypes.length > 0 || activityNames.length > 0 || hasStretch;
    return `
        <button class="calendar-day calendar-day-zoom ${hasAny ? 'calendar-day-has-data' : ''}" data-day-key="${key}">
            <span class="calendar-day-num">${date.getDate()}</span>
            <span class="calendar-marker-row">
                ${workoutMarkers}
                ${activityMarkers}
                ${stretchMarker}
            </span>
        </button>
    `;
}

function onDayClick(event) {
    const dayBtn = event.target.closest('[data-day-key]');
    if (!dayBtn) return;
    openOverlay(dayBtn.dataset.dayKey);
}

function openOverlay(dayKey) {
    if (!overlayEl) return;
    hideError();
    dateInput.value = dayKey || toDayKey(new Date());
    newNameInput.value = '';
    fillActivityOptions();
    onSelectChanged();
    overlayEl.classList.remove('hidden');
}

function closeOverlay() {
    if (!overlayEl) return;
    overlayEl.classList.add('hidden');
    hideError();
}

function fillActivityOptions() {
    const recent = getRecentActivityNames();
    const options = [`<option value="${NEW_ACTIVITY_VALUE}">+ New</option>`];
    for (const name of recent) {
        options.push(`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`);
    }
    selectInput.innerHTML = options.join('');
    selectInput.value = recent.length > 0 ? recent[0] : NEW_ACTIVITY_VALUE;
}

function onSelectChanged() {
    const useNew = selectInput.value === NEW_ACTIVITY_VALUE;
    newNameRow.classList.toggle('hidden', !useNew);
    if (useNew) newNameInput.focus();
}

async function onSave() {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    hideError();
    try {
        const selectedDate = toInputDate(dateInput.value);
        const selectedName = selectedActivityName();
        if (!selectedName) throw new Error('Activity name is required');
        await saveActivity(selectedName, selectedDate);
        pushRecentActivityName(selectedName);
        closeOverlay();
        await Promise.all([
            refreshActivityCalendar(),
            refreshDashboard(),
        ]);
    } catch (err) {
        showError(err.message || 'Failed to save activity');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = saveDefaultText;
    }
}

function selectedActivityName() {
    const selected = selectInput.value;
    if (selected === NEW_ACTIVITY_VALUE) return String(newNameInput.value || '').trim();
    return String(selected || '').trim();
}

function toInputDate(value) {
    const date = value ? new Date(`${value}T12:00:00`) : new Date();
    if (Number.isNaN(date.getTime())) throw new Error('Invalid activity date');
    return date;
}

function setEmptyState(isEmpty) {
    if (!emptyEl) return;
    emptyEl.classList.toggle('hidden', !isEmpty);
}

function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
}

function hideError() {
    if (!errorEl) return;
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
}

function buildDayWindow(days) {
    const start = getWindowStart(days);
    const out = [];
    for (let i = 0; i < days; i++) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        out.push(date);
    }
    return out;
}

function getWindowStart(days) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    return start;
}

function activityNamesForDay(items) {
    const byDay = new Map();
    for (const item of items || []) {
        const key = toDayKey(item.timestamp);
        const name = String(item.activityName || '').trim();
        if (!key || !name) continue;
        const list = byDay.get(key) || [];
        if (!list.includes(name)) list.push(name);
        byDay.set(key, list);
    }
    return byDay;
}

function workoutTypesForDay(items) {
    const byDay = new Map();
    for (const item of items || []) {
        const key = toDayKey(item.timestamp);
        const type = normalizeMachineType(item.machineType) || 'unknown';
        if (!key) continue;
        const list = byDay.get(key) || [];
        if (!list.includes(type)) list.push(type);
        byDay.set(key, list);
    }
    return byDay;
}

function stretchCompletionDays(items) {
    const daySet = new Set();
    for (const item of items || []) {
        const key = toDayKey(item.timestamp);
        if (!key) continue;
        daySet.add(key);
    }
    return daySet;
}

function toDayKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function dedupeRecent(items) {
    const seen = new Set();
    const output = [];
    for (const item of items || []) {
        const clean = String(item || '').trim();
        const key = clean.toLowerCase();
        if (!clean || seen.has(key)) continue;
        seen.add(key);
        output.push(clean);
    }
    return output;
}

function sameActivityName(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
