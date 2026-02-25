import { extractHealthFromImage, matchHealthMetrics } from './llm.js';
import { queryHealthMeasurements, saveOrMergeHealthMeasurement } from './firebase.js';
import { toMetricKey } from './health-matching.js';
import { STORAGE_KEYS } from './config.js';
import {
    readFileAsDataURL, resizeImage, extractPhotoDate, toDateInputValue,
    show, hide,
} from './utils.js';

let photoInputCamera, photoInputLibrary, idleEl, loadingEl, reviewEl, errorEl, savedEl;
let reviewListEl, errorMsg, dateInput;
let saveBtn, retakeBtn, retryBtn, logAnotherBtn;
let metricSelect, chartCanvas, chartContainer, chartScrollArea, emptyEl;
let chart = null;

let pendingReviewRows = [];
let trackedMetricKeys = [];
let cachedHealthRecords = [];
const MIN_POINT_WIDTH_PX = 28;
const DEFAULT_TRACKED_STATS = [
    'Height',
    'Weight',
];

export function initHealth() {
    photoInputCamera = document.getElementById('health-photo-input-camera');
    photoInputLibrary = document.getElementById('health-photo-input-library');
    idleEl = document.getElementById('health-idle');
    loadingEl = document.getElementById('health-loading');
    reviewEl = document.getElementById('health-review');
    errorEl = document.getElementById('health-error');
    savedEl = document.getElementById('health-saved');
    reviewListEl = document.getElementById('health-review-list');
    errorMsg = document.getElementById('health-error-msg');
    dateInput = document.getElementById('health-date');
    saveBtn = document.getElementById('save-health-btn');
    retakeBtn = document.getElementById('health-retake-btn');
    retryBtn = document.getElementById('health-error-retry-btn');
    logAnotherBtn = document.getElementById('health-log-another-btn');
    metricSelect = document.getElementById('health-metric-select');
    chartCanvas = document.getElementById('health-chart');
    chartContainer = document.getElementById('health-chart-container');
    chartScrollArea = document.getElementById('health-chart-scroll-area');
    emptyEl = document.getElementById('health-empty');

    photoInputCamera.addEventListener('change', onPhotoSelected);
    photoInputLibrary.addEventListener('change', onPhotoSelected);
    saveBtn.addEventListener('click', onSave);
    retakeBtn.addEventListener('click', resetHealthToIdle);
    retryBtn.addEventListener('click', resetHealthToIdle);
    logAnotherBtn.addEventListener('click', resetHealthToIdle);
    metricSelect.addEventListener('change', renderChart);
}

export async function refreshHealth() {
    try {
        cachedHealthRecords = await queryHealthMeasurements(null);
        trackedMetricKeys = getTrackedStats();
        trackedMetricKeys = mergeTrackedStats(trackedMetricKeys, collectKnownMetricKeys(cachedHealthRecords));
        saveTrackedStats(trackedMetricKeys);
        refreshMetricOptions();
        renderChart();
    } catch (err) {
        console.error('Failed to load health data:', err);
        cachedHealthRecords = [];
        trackedMetricKeys = getTrackedStats();
        refreshMetricOptions();
        renderChart();
    }
}

export function resetHealthToIdle() {
    pendingReviewRows = [];
    photoInputCamera.value = '';
    photoInputLibrary.value = '';
    reviewListEl.innerHTML = '';
    showState(idleEl);
}

async function onPhotoSelected(event) {
    const fileInput = event?.currentTarget;
    const file = fileInput?.files?.[0];
    if (!file) return;
    showState(loadingEl);

    try {
        const [photoDate, dataURL] = await Promise.all([
            extractPhotoDate(file),
            readFileAsDataURL(file),
        ]);
        if (trackedMetricKeys.length === 0) await refreshHealth();

        const resized = await resizeImage(dataURL);
        const extracted = await extractHealthFromImage(resized, trackedMetricKeys);
        pendingReviewRows = await matchHealthMetrics(extracted, trackedMetricKeys);
        dateInput.value = toDateInputValue(photoDate);
        renderReviewRows(pendingReviewRows);
        showState(reviewEl);
    } catch (err) {
        console.error('Health extraction failed:', err);
        errorMsg.textContent = err.message || 'Health extraction failed. Try again.';
        showState(errorEl);
    }
}

async function onSave() {
    if (pendingReviewRows.length === 0) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const reviewed = readReviewRows();
        const measurements = reviewed.reduce((acc, row) => {
            const key = toMetricKey(row.selectedKey);
            if (!key) return acc;
            acc[key] = row.value;
            return acc;
        }, {});
        const selectedDate = dateInput.value
            ? new Date(dateInput.value + 'T12:00:00')
            : new Date();

        const reviewMeta = {
            reviewedAt: new Date().toISOString(),
            rows: reviewed.map((row) => ({
                name: row.name,
                unit: row.unit,
                status: row.status,
                selectedKey: row.selectedKey,
                confidence: row.confidence,
            })),
        };
        await saveOrMergeHealthMeasurement(selectedDate, measurements, reviewMeta);
        trackedMetricKeys = mergeTrackedStats(
            trackedMetricKeys,
            reviewed.map((row) => row.selectedKey),
        );
        saveTrackedStats(trackedMetricKeys);
        await refreshHealth();
        pendingReviewRows = [];
        showState(savedEl);
    } catch (err) {
        console.error('Health save failed:', err);
        errorMsg.textContent = `Save failed: ${err.message}`;
        showState(errorEl);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Measurements';
    }
}

function renderReviewRows(rows) {
    if (!rows.length) {
        reviewListEl.innerHTML = '<p class="empty-text">No measurable values found in that image.</p>';
        return;
    }
    reviewListEl.innerHTML = rows.map((row, index) => reviewRowHTML(row, index)).join('');
}

function reviewRowHTML(row, index) {
    const keyOptions = buildOptions(row);
    const confidencePct = Math.round((row.confidence ?? 0.5) * 100);
    const matchLabel = row.status === 'exact'
        ? 'Exact match'
        : row.status === 'close'
            ? `Close match: ${row.suggestedKey}`
            : 'New metric';

    return `
        <div class="health-review-row" data-index="${index}">
            <div class="health-row-header">
                <span class="field-label">${row.name}</span>
                <span class="health-match-tag health-match-${row.status}">${matchLabel}</span>
            </div>
            <div class="health-row-grid">
                <label class="field">
                    <span class="field-label">Value</span>
                    <input class="input health-value-input" type="number" step="any" value="${row.value}">
                </label>
                <label class="field">
                    <span class="field-label">Unit</span>
                    <input class="input health-unit-input" type="text" value="${escapeHtml(row.unit || '')}" placeholder="in, lb, mm, sec">
                </label>
                <label class="field">
                    <span class="field-label">Metric key</span>
                    <input list="health-metric-options-${index}" class="input health-key-input" value="${escapeHtml(row.selectedKey)}">
                    <datalist id="health-metric-options-${index}">
                        ${keyOptions}
                    </datalist>
                </label>
                <div class="field">
                    <span class="field-label">Confidence</span>
                    <span class="field-value">${confidencePct}%</span>
                </div>
            </div>
        </div>
    `;
}

function buildOptions(row) {
    const options = new Set([
        ...(row.knownOptions || []),
        row.suggestedKey,
        row.selectedKey,
    ].filter(Boolean));
    return [...options].sort().map((opt) => `<option value="${escapeHtml(opt)}"></option>`).join('');
}

function readReviewRows() {
    const rows = [];
    const rowEls = reviewListEl.querySelectorAll('.health-review-row');
    for (const rowEl of rowEls) {
        const index = Number(rowEl.dataset.index);
        const source = pendingReviewRows[index];
        if (!source) continue;

        const valueInput = rowEl.querySelector('.health-value-input');
        const unitInput = rowEl.querySelector('.health-unit-input');
        const keyInput = rowEl.querySelector('.health-key-input');
        const value = Number(valueInput?.value);
        const selectedKey = toMetricKey(keyInput?.value || source.selectedKey);

        if (Number.isNaN(value)) {
            throw new Error(`Value for "${source.name}" must be a number`);
        }
        if (!selectedKey) {
            throw new Error(`Metric key for "${source.name}" is required`);
        }

        rows.push({
            name: source.name,
            unit: String(unitInput?.value || '').trim(),
            status: source.status,
            selectedKey,
            confidence: source.confidence,
            value,
        });
    }
    return rows;
}

function collectKnownMetricKeys(records) {
    const keys = new Set();
    for (const record of records) {
        for (const key of Object.keys(record.measurements || {})) {
            keys.add(key);
        }
    }
    return [...keys].sort();
}

function refreshMetricOptions() {
    const current = metricSelect.value;
    if (trackedMetricKeys.length === 0) {
        metricSelect.innerHTML = '<option value="">No metrics</option>';
        metricSelect.disabled = true;
        return;
    }
    metricSelect.disabled = false;
    metricSelect.innerHTML = trackedMetricKeys
        .map((key) => `<option value="${escapeHtml(key)}">${humanizeMetricKey(key)}</option>`)
        .join('');
    if (trackedMetricKeys.includes(current)) {
        metricSelect.value = current;
    }
}

function renderChart() {
    if (chart) chart.destroy();
    const metricKey = metricSelect.value;
    if (!metricKey || cachedHealthRecords.length === 0) {
        show(emptyEl);
        chart = createHealthChart([], [], metricKey);
        chartScrollArea.style.width = '100%';
        return;
    }
    const series = buildSeries(metricKey, cachedHealthRecords);
    showOrHideEmpty(series.data);
    updateScrollWidth(series.labels.length);
    chart = createHealthChart(series.labels, series.data, metricKey);
}

function buildSeries(metricKey, records) {
    const byDay = new Map();
    let start = new Date();
    start.setHours(0, 0, 0, 0);
    for (const record of records) {
        const key = String(record.dayKey || dateKey(record.timestamp));
        byDay.set(key, record);
        const d = parseDayKey(key);
        if (d < start) start = d;
    }

    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const labels = [];
    const data = [];
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = dateKey(d);
        const record = byDay.get(key);
        labels.push(formatDayLabel(d));
        if (!record) {
            data.push(null);
            continue;
        }
        const value = record.measurements?.[metricKey];
        data.push(value == null ? null : Number(value));
    }
    return { labels, data };
}

function createHealthChart(labels, data, metricKey) {
    const label = humanizeMetricKey(metricKey || 'Metric');
    return new Chart(chartCanvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label,
                data,
                borderColor: '#4f8cff',
                backgroundColor: '#4f8cff66',
                borderWidth: 2,
                pointRadius: 3,
                pointHoverRadius: 5,
                tension: 0.2,
                spanGaps: false,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ctx.parsed.y == null ? '--' : String(ctx.parsed.y),
                    },
                },
            },
            scales: {
                x: {
                    ticks: { color: '#9ca3b4', maxRotation: 45, font: { size: 10 } },
                    grid: { display: false },
                },
                y: {
                    beginAtZero: false,
                    ticks: { color: '#9ca3b4' },
                    grid: { color: '#2e334533' },
                },
            },
        },
    });
}

function showOrHideEmpty(data) {
    const hasValue = data.some((value) => value != null);
    if (hasValue) hide(emptyEl);
    else show(emptyEl);
}

function updateScrollWidth(pointCount) {
    const containerWidth = chartContainer.clientWidth;
    const needed = pointCount * MIN_POINT_WIDTH_PX;
    chartScrollArea.style.width = needed > containerWidth ? `${needed}px` : '100%';
}

function parseDayKey(key) {
    const date = new Date(`${key}T12:00:00`);
    if (Number.isNaN(date.getTime())) return new Date();
    return date;
}

function dateKey(date) {
    if (!(date instanceof Date)) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDayLabel(date) {
    if (!(date instanceof Date)) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function humanizeMetricKey(key) {
    const raw = String(key || '').trim();
    if (!raw.includes('_')) return raw;
    return raw
        .split('_')
        .filter(Boolean)
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(' ');
}

function showState(active) {
    for (const el of [idleEl, loadingEl, reviewEl, errorEl, savedEl]) {
        if (el === active) show(el);
        else hide(el);
    }
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function getTrackedStats() {
    const raw = localStorage.getItem(STORAGE_KEYS.healthTrackedStats);
    if (!raw) return [...DEFAULT_TRACKED_STATS];
    try {
        const parsed = JSON.parse(raw);
        const stats = Array.isArray(parsed) ? parsed : [];
        const cleaned = stats
            .map((item) => toMetricKey(item))
            .filter(Boolean);
        if (cleaned.length === 0) return [...DEFAULT_TRACKED_STATS];
        return dedupeByNormalizedKey(cleaned);
    } catch {
        return [...DEFAULT_TRACKED_STATS];
    }
}

function saveTrackedStats(stats) {
    const cleaned = dedupeByNormalizedKey(stats.map((item) => toMetricKey(item)).filter(Boolean));
    localStorage.setItem(STORAGE_KEYS.healthTrackedStats, JSON.stringify(cleaned));
}

function mergeTrackedStats(base, extra) {
    return dedupeByNormalizedKey([...(base || []), ...(extra || [])]);
}

function dedupeByNormalizedKey(list) {
    const byKey = new Map();
    for (const item of list || []) {
        const readable = toMetricKey(item);
        const normalized = readable.toLowerCase();
        if (!readable || byKey.has(normalized)) continue;
        byKey.set(normalized, readable);
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}
