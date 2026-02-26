import { queryWorkouts } from './firebase.js';
import { show, hide, formatDuration, formatNum } from './utils.js';
import { machineTypeColor, machineTypeLabel, normalizeMachineType } from './machineType.js';

// DOM refs
let metricSelect, granularitySelect, chartCanvas, chartContainer, chartScrollArea;
let workoutListEl, emptyEl;
let chart = null;

// Cached workouts from last query
let cachedWorkouts = [];

// Per-bar state for selection and detail
let selectedIndex = -1;
let workoutByDate = new Map(); // dateKey -> workouts[]
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
        chart = createChart(chartCanvas, singleSeries([], []), config);
        return;
    }

    hide(emptyEl);
    show(workoutListEl);
    populateWorkoutByDate();

    const series = buildSeries(config);
    const barColors = series.stacked ? null : buildBarColors();
    updateScrollWidth(series.labels.length);

    selectedIndex = findLastBucketWithWorkout();
    chart = createChart(chartCanvas, series, config, barColors);
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
        workoutListEl.innerHTML = workouts.map((workout) => workoutCardHTML(workout)).join('');
    } else {
        workoutListEl.innerHTML = averageCardHTML(workouts, range);
    }
}

// --- Series building -------------------------------------------------------

function populateWorkoutByDate() {
    workoutByDate = new Map();
    for (const w of cachedWorkouts) {
        const key = dateKey(w.timestamp);
        if (!workoutByDate.has(key)) {
            workoutByDate.set(key, []);
        }
        workoutByDate.get(key).push(w);
    }
    for (const workouts of workoutByDate.values()) {
        workouts.sort((a, b) => a.timestamp - b.timestamp);
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
    const labels = [];
    const dailyWorkouts = [];
    bucketWorkouts = [];
    bucketRanges = [];

    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = dateKey(d);
        const workouts = workoutByDate.get(key) || [];
        labels.push(formatDayLabel(d));
        dailyWorkouts.push(workouts);
        bucketWorkouts.push(workouts);
        bucketRanges.push({ start: new Date(d), end: new Date(d) });
    }
    return buildDailySeries(labels, dailyWorkouts, config.getValue);
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
    return singleSeries(labels, data);
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
    return singleSeries(labels, data);
}

/** Collect workouts and metric sum for a date range. */
function collectBucket(start, end, getValue) {
    const workouts = [];
    let sum = 0;
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayWorkouts = workoutByDate.get(dateKey(d)) || [];
        if (dayWorkouts.length > 0) {
            workouts.push(...dayWorkouts);
            sum += sumMetric(dayWorkouts, getValue);
        }
    }
    return { workouts, sum };
}

function buildDailySeries(labels, dailyWorkouts, getValue) {
    const maxPerDay = dailyWorkouts.reduce((best, workouts) => Math.max(best, workouts.length), 0);
    if (maxPerDay <= 1) {
        const data = dailyWorkouts.map((workouts) => sumMetric(workouts, getValue));
        return singleSeries(labels, data);
    }

    const datasets = [];
    for (let i = 0; i < maxPerDay; i++) {
        const data = [];
        const background = [];
        const border = [];
        for (const workouts of dailyWorkouts) {
            const workout = workouts[i];
            if (!workout) {
                data.push(0);
                background.push('transparent');
                border.push('transparent');
                continue;
            }
            const value = getValue(workout) ?? 0;
            const type = normalizeMachineType(workout.machineType) || 'unknown';
            const color = machineTypeColor(type);
            data.push(value);
            background.push(withAlpha(color, 'cc'));
            border.push(color);
        }
        datasets.push({
            label: `Workout ${i + 1}`,
            data,
            backgroundColor: background,
            borderColor: border,
            borderWidth: 1,
            borderRadius: 4,
            minBarLength: 1,
            stack: 'daily-workouts',
        });
    }
    return { labels, datasets, stacked: true };
}

function singleSeries(labels, data) {
    return { labels, data, stacked: false };
}

function sumMetric(workouts, getValue) {
    let total = 0;
    for (const workout of workouts) {
        total += getValue(workout) ?? 0;
    }
    return total;
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

function createChart(canvas, series, config, barColors = null) {
    const datasets = series.datasets || [{
        label: config.label,
        data: series.data,
        backgroundColor: barColors?.background || (config.color + 'cc'),
        borderColor: barColors?.border || config.color,
        borderWidth: 1,
        borderRadius: 4,
        minBarLength: 1,
    }];
    applyBarGradients(datasets, config.color);

    return new Chart(canvas, {
        type: 'bar',
        data: {
            labels: series.labels,
            datasets,
        },
        plugins: [selectionLinePlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: onChartClick,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: series.stacked ? 'index' : 'nearest',
                    intersect: !series.stacked,
                    callbacks: {
                        label: (ctx) => {
                            const value = config.format(ctx.parsed.y);
                            if (!series.stacked) return value;
                            return `${ctx.dataset.label}: ${value}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    stacked: series.stacked,
                    ticks: { color: '#9ca3b4', maxRotation: 45, font: { size: 10 } },
                    grid: { display: false },
                },
                y: {
                    beginAtZero: true,
                    stacked: series.stacked,
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

function applyBarGradients(datasets, fallbackColor) {
    for (const dataset of datasets) {
        const baseColors = toColorArray(dataset.borderColor, fallbackColor);
        dataset.backgroundColor = (ctx) => {
            const color = baseColors[ctx.dataIndex] || fallbackColor;
            if (!color || color === 'transparent') return 'transparent';
            return verticalGradient(ctx.chart, color);
        };
    }
}

function toColorArray(colorOrArray, fallbackColor) {
    if (Array.isArray(colorOrArray)) return colorOrArray;
    return [colorOrArray || fallbackColor];
}

function verticalGradient(chart, color) {
    const area = chart.chartArea;
    if (!area) return withAlpha(color, 'cc');
    const topColor = withAlpha(adjustHexColor(color, 0.18), 'cc');
    const bottomColor = withAlpha(adjustHexColor(color, -0.24), 'dd');
    const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    gradient.addColorStop(0, topColor);
    gradient.addColorStop(1, bottomColor);
    return gradient;
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

function buildBarColors() {
    const background = [];
    const border = [];

    for (const workouts of bucketWorkouts) {
        const type = dominantMachineType(workouts);
        const color = machineTypeColor(type);
        background.push(withAlpha(color, 'cc'));
        border.push(color);
    }

    return { background, border };
}

function dominantMachineType(workouts) {
    if (!workouts || workouts.length === 0) return null;

    const counts = new Map();
    for (const workout of workouts) {
        const type = normalizeMachineType(workout.machineType) || 'unknown';
        counts.set(type, (counts.get(type) || 0) + 1);
    }

    let bestType = null;
    let bestCount = -1;
    for (const [type, count] of counts.entries()) {
        if (count > bestCount) {
            bestType = type;
            bestCount = count;
        }
    }
    return bestType;
}

function withAlpha(hexColor, alphaHex) {
    if (typeof hexColor !== 'string') return hexColor;
    return /^#[0-9a-fA-F]{6}$/.test(hexColor) ? `${hexColor}${alphaHex}` : hexColor;
}

function adjustHexColor(hexColor, amount) {
    if (typeof hexColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hexColor)) return hexColor;
    const channels = [1, 3, 5].map((offset) => parseInt(hexColor.slice(offset, offset + 2), 16));
    const adjusted = channels.map((channel) => {
        if (amount >= 0) {
            return Math.round(channel + ((255 - channel) * amount));
        }
        return Math.round(channel * (1 + amount));
    });
    return `#${adjusted.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
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
                <span class="machine-type">${machineTypeLabel(w.machineType)}</span>
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
