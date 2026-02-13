import { queryWorkouts } from './firebase.js';
import { show, hide, daysAgo, formatDuration, formatPace, formatNum } from './utils.js';

// DOM refs
let metricSelect, rangeSelect, chartCanvas, workoutListEl, emptyEl;
let chart = null;

// Cached workouts from last query
let cachedWorkouts = [];

// Selection state: which bar index is selected, and the dateKey for each bar
let selectedIndex = -1;
let seriesDateKeys = [];

// Map dateKey -> workout for quick lookup
let workoutByDate = new Map();

// --- Metric display config ---------------------------------------------

const METRIC_CONFIG = {
    calories: {
        label: 'Calories',
        color: '#f97316',
        getValue: (w) => w.calories,
        format: (v) => formatNum(v),
    },
    distanceMiles: {
        label: 'Distance (mi)',
        color: '#4f8cff',
        getValue: (w) => w.distanceMiles,
        format: (v) => formatNum(v, 'mi'),
    },
    elapsedTimeSeconds: {
        label: 'Duration',
        color: '#a78bfa',
        getValue: (w) => w.elapsedTimeSeconds / 60, // display as minutes
        format: (v) => formatDuration(v * 60),
        yLabel: 'Minutes',
    },
    avgSpeedMph: {
        label: 'Avg Speed (mph)',
        color: '#34d399',
        getValue: (w) => w.avgSpeedMph,
        format: (v) => formatNum(v, 'mph'),
    },
    avgHeartRate: {
        label: 'Avg Heart Rate',
        color: '#f87171',
        getValue: (w) => w.avgHeartRate,
        format: (v) => (v != null ? `${Math.round(v)} bpm` : '--'),
    },
};

// --- Public API --------------------------------------------------------

export function initHistory() {
    metricSelect = document.getElementById('metric-select');
    rangeSelect = document.getElementById('range-select');
    chartCanvas = document.getElementById('history-chart');
    workoutListEl = document.getElementById('workout-list');
    emptyEl = document.getElementById('history-empty');

    metricSelect.addEventListener('change', onControlsChanged);
    rangeSelect.addEventListener('change', onControlsChanged);
}

/**
 * Refresh history data from Firestore and redraw the chart + list.
 */
export async function refreshHistory() {
    const rangeDays = parseInt(rangeSelect.value, 10);
    const since = rangeDays > 0 ? daysAgo(rangeDays) : null;

    try {
        cachedWorkouts = await queryWorkouts(since);
    } catch (err) {
        console.error('Failed to load workouts:', err);
        cachedWorkouts = [];
    }

    renderChart();
}

// --- Internal ----------------------------------------------------------

function onControlsChanged() {
    // Range change needs a fresh query; metric change only needs a re-render
    if (document.activeElement === rangeSelect) {
        refreshHistory();
    } else {
        renderChart();
    }
}

function renderChart() {
    const metricKey = metricSelect.value;
    const config = METRIC_CONFIG[metricKey];
    if (!config) return;

    if (chart) chart.destroy();

    if (cachedWorkouts.length === 0) {
        show(emptyEl);
        hide(workoutListEl);
        chart = createChart(chartCanvas, [], [], config);
        return;
    }

    hide(emptyEl);
    show(workoutListEl);

    const { labels, data } = buildDailySeries(config);

    // Default selection to the most recent day that has a workout
    selectedIndex = findLastWorkoutIndex();
    chart = createChart(chartCanvas, labels, data, config);
    renderDetail();
}

/** Fill every calendar day in the range, using 0 for missed days. */
function buildDailySeries(config) {
    const rangeDays = parseInt(rangeSelect.value, 10);
    const sorted = [...cachedWorkouts].reverse(); // oldest-first
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build dateKey -> workout map (shared state for detail panel)
    workoutByDate = new Map();
    for (const w of sorted) {
        const key = dateKey(w.timestamp);
        if (!workoutByDate.has(key)) workoutByDate.set(key, w);
    }

    const start = rangeDays > 0 ? daysAgo(rangeDays) : new Date(sorted[0].timestamp);
    start.setHours(0, 0, 0, 0);

    const labels = [];
    const data = [];
    seriesDateKeys = [];
    for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
        const key = dateKey(d);
        labels.push(formatChartDate(d));
        data.push(workoutByDate.has(key) ? (config.getValue(workoutByDate.get(key)) ?? 0) : 0);
        seriesDateKeys.push(key);
    }
    return { labels, data };
}

function dateKey(d) {
    if (!(d instanceof Date)) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Find the last bar index that has a workout. */
function findLastWorkoutIndex() {
    for (let i = seriesDateKeys.length - 1; i >= 0; i--) {
        if (workoutByDate.has(seriesDateKeys[i])) return i;
    }
    return seriesDateKeys.length - 1;
}

/** Chart.js plugin: draw a thin vertical line over the selected bar. */
const selectionLinePlugin = {
    id: 'selectionLine',
    afterDatasetsDraw(chart) {
        if (selectedIndex < 0) return;
        const meta = chart.getDatasetMeta(0);
        const bar = meta.data[selectedIndex];
        if (!bar) return;

        const { ctx, chartArea } = chart;
        const LINE_WIDTH = 2;
        ctx.save();
        ctx.strokeStyle = '#ffffffcc';
        ctx.lineWidth = LINE_WIDTH;
        ctx.beginPath();
        ctx.moveTo(bar.x, chartArea.top);
        ctx.lineTo(bar.x, chartArea.bottom);
        ctx.stroke();
        ctx.restore();
    },
};

function createChart(canvas, labels, data, config) {
    return new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: config.label,
                    data,
                    backgroundColor: config.color + 'cc',
                    borderColor: config.color,
                    borderWidth: 1,
                    borderRadius: 4,
                    minBarLength: 1,
                },
            ],
        },
        plugins: [selectionLinePlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: onChartClick,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => config.format(ctx.parsed.y),
                    },
                },
            },
            scales: {
                x: {
                    ticks: { color: '#9ca3b4', maxRotation: 45, font: { size: 10 } },
                    grid: { display: false },
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: Boolean(config.yLabel),
                        text: config.yLabel || '',
                        color: '#9ca3b4',
                    },
                    ticks: { color: '#9ca3b4' },
                    grid: { color: '#2e334533' },
                },
            },
        },
    });
}

function onChartClick(_event, elements) {
    if (elements.length === 0) return;
    selectedIndex = elements[0].index;
    chart.update('none'); // redraw selection line without animation
    renderDetail();
}

/** Show a single workout card for the selected day, or nothing for a missed day. */
function renderDetail() {
    const key = seriesDateKeys[selectedIndex];
    const workout = key ? workoutByDate.get(key) : null;
    workoutListEl.innerHTML = workout ? workoutCardHTML(workout) : '';
}

function workoutCardHTML(w) {
    const date = w.timestamp instanceof Date
        ? w.timestamp.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : '';

    return `
        <div class="workout-card">
            <div class="card-header">
                <span class="workout-date">${date}</span>
            </div>
            <div class="card-fields">
                ${fieldHTML('Duration', formatDuration(w.elapsedTimeSeconds))}
                ${fieldHTML('Calories', formatNum(w.calories))}
                ${fieldHTML('Distance', formatNum(w.distanceMiles, 'mi'))}
                ${fieldHTML('Avg Speed', formatNum(w.avgSpeedMph, 'mph'))}
                ${fieldHTML('Climbed', w.distanceClimbedFeet != null ? formatNum(w.distanceClimbedFeet, 'ft') : '--')}
                ${fieldHTML('Heart Rate', w.avgHeartRate != null ? `${w.avgHeartRate} bpm` : '--')}
            </div>
        </div>
    `;
}

function fieldHTML(label, value) {
    return `
        <div class="field">
            <span class="field-label">${label}</span>
            <span class="field-value">${value}</span>
        </div>
    `;
}

function formatChartDate(date) {
    if (!(date instanceof Date)) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
