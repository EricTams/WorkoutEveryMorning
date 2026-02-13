import { queryWorkouts } from './firebase.js';
import { show, hide, formatDuration, formatNum } from './utils.js';

// DOM refs
let metricSelect, granularitySelect, chartCanvas, chartContainer, chartScrollArea;
let workoutListEl, emptyEl;
let chart = null;

// Cached workouts from last query
let cachedWorkouts = [];

// Per-bar state for selection and detail
let selectedIndex = -1;
let workoutByDate = new Map(); // dateKey -> workout
let bucketWorkouts = [];       // workouts[] per bar
let bucketRanges = [];         // { start: Date, end: Date } per bar

// --- Named constants -------------------------------------------------------

const DAYS_PER_WEEK = 7;
const MIN_BAR_WIDTH_PX = 28;

// --- Metric display config -------------------------------------------------

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
        getValue: (w) => w.elapsedTimeSeconds / 60,
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

// --- Public API ------------------------------------------------------------

export function initHistory() {
    metricSelect = document.getElementById('metric-select');
    granularitySelect = document.getElementById('granularity-select');
    chartCanvas = document.getElementById('history-chart');
    chartContainer = document.getElementById('chart-container');
    chartScrollArea = document.getElementById('chart-scroll-area');
    workoutListEl = document.getElementById('workout-list');
    emptyEl = document.getElementById('history-empty');

    metricSelect.addEventListener('change', renderChart);
    granularitySelect.addEventListener('change', renderChart);
}

/** Refresh history data from Firestore and redraw. */
export async function refreshHistory() {
    try {
        cachedWorkouts = await queryWorkouts(null);
    } catch (err) {
        console.error('Failed to load workouts:', err);
        cachedWorkouts = [];
    }
    renderChart();
}

// --- Rendering -------------------------------------------------------------

function renderChart() {
    const metricKey = metricSelect.value;
    const config = METRIC_CONFIG[metricKey];
    if (!config) return;

    if (chart) chart.destroy();

    if (cachedWorkouts.length === 0) {
        show(emptyEl);
        hide(workoutListEl);
        chartScrollArea.style.width = '100%';
        chart = createChart(chartCanvas, [], [], config);
        return;
    }

    hide(emptyEl);
    show(workoutListEl);
    populateWorkoutByDate();

    const { labels, data } = buildSeries(config);
    updateScrollWidth(labels.length);

    selectedIndex = findLastBucketWithWorkout();
    chart = createChart(chartCanvas, labels, data, config);
    chartContainer.scrollLeft = chartContainer.scrollWidth;
    renderDetail();
}

function renderDetail() {
    if (selectedIndex < 0) {
        workoutListEl.innerHTML = '';
        return;
    }
    const workouts = bucketWorkouts[selectedIndex];
    const range = bucketRanges[selectedIndex];

    if (!workouts || workouts.length === 0) {
        workoutListEl.innerHTML = '';
        return;
    }

    const granularity = granularitySelect.value;
    if (granularity === 'daily') {
        workoutListEl.innerHTML = workoutCardHTML(workouts[0]);
    } else {
        workoutListEl.innerHTML = averageCardHTML(workouts, range);
    }
}

// --- Series building -------------------------------------------------------

function populateWorkoutByDate() {
    workoutByDate = new Map();
    for (const w of cachedWorkouts) {
        const key = dateKey(w.timestamp);
        if (!workoutByDate.has(key)) workoutByDate.set(key, w);
    }
}

function buildSeries(config) {
    const sorted = [...cachedWorkouts].reverse();
    const start = new Date(sorted[0].timestamp);
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(0, 0, 0, 0);

    const granularity = granularitySelect.value;
    if (granularity === 'weekly') return buildWeekly(config, start, end);
    if (granularity === 'monthly') return buildMonthly(config, start, end);
    return buildDaily(config, start, end);
}

function buildDaily(config, start, end) {
    const labels = [], data = [];
    bucketWorkouts = [];
    bucketRanges = [];

    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = dateKey(d);
        const w = workoutByDate.get(key);
        labels.push(formatDayLabel(d));
        data.push(w ? (config.getValue(w) ?? 0) : 0);
        bucketWorkouts.push(w ? [w] : []);
        bucketRanges.push({ start: new Date(d), end: new Date(d) });
    }
    return { labels, data };
}

function buildWeekly(config, start, end) {
    const labels = [], data = [];
    bucketWorkouts = [];
    bucketRanges = [];

    for (const cur = alignToMonday(start); cur <= end; cur.setDate(cur.getDate() + DAYS_PER_WEEK)) {
        const weekEnd = new Date(cur);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const { workouts, sum } = collectBucket(cur, weekEnd, config.getValue);

        labels.push(formatDayLabel(cur));
        data.push(sum / DAYS_PER_WEEK);
        bucketWorkouts.push(workouts);
        bucketRanges.push({ start: new Date(cur), end: weekEnd });
    }
    return { labels, data };
}

function buildMonthly(config, start, end) {
    const labels = [], data = [];
    bucketWorkouts = [];
    bucketRanges = [];

    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
        const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
        const { workouts, sum } = collectBucket(cursor, monthEnd, config.getValue);

        labels.push(formatMonthLabel(cursor));
        data.push(sum / monthEnd.getDate());
        bucketWorkouts.push(workouts);
        bucketRanges.push({ start: new Date(cursor), end: monthEnd });
        cursor.setMonth(cursor.getMonth() + 1);
    }
    return { labels, data };
}

/** Collect workouts and metric sum for a date range. */
function collectBucket(start, end, getValue) {
    const workouts = [];
    let sum = 0;
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const w = workoutByDate.get(dateKey(d));
        if (w) {
            workouts.push(w);
            sum += getValue(w) ?? 0;
        }
    }
    return { workouts, sum };
}

// --- Chart -----------------------------------------------------------------

/** Chart.js plugin: thin vertical line on selected bar. */
const selectionLinePlugin = {
    id: 'selectionLine',
    afterDatasetsDraw(chart) {
        if (selectedIndex < 0) return;
        const bar = chart.getDatasetMeta(0).data[selectedIndex];
        if (!bar) return;

        const { ctx, chartArea } = chart;
        ctx.save();
        ctx.strokeStyle = '#ffffffcc';
        ctx.lineWidth = 2;
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
            datasets: [{
                label: config.label,
                data,
                backgroundColor: config.color + 'cc',
                borderColor: config.color,
                borderWidth: 1,
                borderRadius: 4,
                minBarLength: 1,
            }],
        },
        plugins: [selectionLinePlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: onChartClick,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: (ctx) => config.format(ctx.parsed.y) },
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

function updateScrollWidth(barCount) {
    const containerWidth = chartContainer.clientWidth;
    const needed = barCount * MIN_BAR_WIDTH_PX;
    chartScrollArea.style.width = needed > containerWidth ? `${needed}px` : '100%';
}

function onChartClick(_event, elements) {
    if (elements.length === 0) return;
    selectedIndex = elements[0].index;
    chart.update('none');
    renderDetail();
}

// --- Helpers ---------------------------------------------------------------

function alignToMonday(date) {
    const d = new Date(date);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
}

function dateKey(d) {
    if (!(d instanceof Date)) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function findLastBucketWithWorkout() {
    for (let i = bucketWorkouts.length - 1; i >= 0; i--) {
        if (bucketWorkouts[i].length > 0) return i;
    }
    return bucketWorkouts.length - 1;
}

/** Average a field across workouts, skipping nulls. Returns null if none. */
function avgOf(workouts, fn) {
    const vals = workouts.map(fn).filter((v) => v != null);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function daySpan(start, end) {
    return Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

// --- Card templates --------------------------------------------------------

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

function averageCardHTML(workouts, range) {
    const total = daySpan(range.start, range.end);
    const label = formatRangeLabel(range);

    return `
        <div class="workout-card">
            <div class="card-header">
                <span class="workout-date">${label}</span>
                <span class="field-label">${workouts.length} of ${total} days</span>
            </div>
            <div class="card-fields">
                ${fieldHTML('Avg Duration', formatDuration(avgOf(workouts, (w) => w.elapsedTimeSeconds)))}
                ${fieldHTML('Avg Calories', formatNum(avgOf(workouts, (w) => w.calories)))}
                ${fieldHTML('Avg Distance', formatNum(avgOf(workouts, (w) => w.distanceMiles), 'mi'))}
                ${fieldHTML('Avg Speed', formatNum(avgOf(workouts, (w) => w.avgSpeedMph), 'mph'))}
                ${fieldHTML('Avg Heart Rate', avgOf(workouts, (w) => w.avgHeartRate) != null
                    ? `${Math.round(avgOf(workouts, (w) => w.avgHeartRate))} bpm` : '--')}
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

// --- Date formatting -------------------------------------------------------

function formatDayLabel(date) {
    if (!(date instanceof Date)) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMonthLabel(date) {
    if (!(date instanceof Date)) return '';
    return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function formatRangeLabel(range) {
    const s = range.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const e = range.end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return `${s} – ${e}`;
}
