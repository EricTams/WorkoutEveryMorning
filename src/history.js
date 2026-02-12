import { queryWorkouts } from './firebase.js';
import { show, hide, daysAgo, formatDuration, formatPace, formatNum } from './utils.js';

// DOM refs
let metricSelect, rangeSelect, chartCanvas, workoutListEl, emptyEl;
let chart = null;

// Cached workouts from last query
let cachedWorkouts = [];

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
    renderList();
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

    // Sort oldest-first for chart x-axis
    const sorted = [...cachedWorkouts].reverse();
    const labels = sorted.map((w) => formatChartDate(w.timestamp));
    const data = sorted.map((w) => config.getValue(w) ?? 0);

    if (chart) {
        chart.destroy();
    }

    if (sorted.length === 0) {
        show(emptyEl);
        hide(workoutListEl);
        // Draw an empty chart
        chart = createChart(chartCanvas, [], [], config);
        return;
    }

    hide(emptyEl);
    show(workoutListEl);
    chart = createChart(chartCanvas, labels, data, config);
}

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
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
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

function renderList() {
    if (cachedWorkouts.length === 0) {
        workoutListEl.innerHTML = '';
        return;
    }

    workoutListEl.innerHTML = cachedWorkouts
        .map((w) => workoutCardHTML(w))
        .join('');
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
