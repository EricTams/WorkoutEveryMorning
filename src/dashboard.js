import { queryWorkouts } from './firebase.js';
import { machineTypeColor, machineTypeLabel, normalizeMachineType } from './machineType.js';
import { formatNum } from './utils.js';

const LOOKBACK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MACHINE_ORDER = ['treadmill', 'cycle', 'eliptical', 'unknown'];

let emptyEl, contentEl;
let streakDaysEl, longestStreakEl;
let averageMinutesEl, typicalMinutesEl;
let averageCaloriesEl, typicalCaloriesEl;
let machineMixCanvas;
let machineMixChart = null;

export function initDashboard() {
    emptyEl = document.getElementById('dashboard-empty');
    contentEl = document.getElementById('dashboard-content');
    streakDaysEl = document.getElementById('dash-streak-days');
    longestStreakEl = document.getElementById('dash-longest-streak');
    averageMinutesEl = document.getElementById('dash-average-minutes');
    typicalMinutesEl = document.getElementById('dash-typical-minutes');
    averageCaloriesEl = document.getElementById('dash-average-calories');
    typicalCaloriesEl = document.getElementById('dash-typical-calories');
    machineMixCanvas = document.getElementById('dashboard-machine-mix-chart');
}

export async function refreshDashboard() {
    try {
        const workouts = await queryWorkouts(null);
        const windowed = filterToLastNDays(workouts, LOOKBACK_DAYS);
        renderDashboard(windowed);
    } catch (err) {
        console.error('Failed to load dashboard data:', err);
        renderDashboard([]);
    }
}

function renderDashboard(workouts) {
    if (!workouts.length) {
        showEmptyState();
        renderMachineMix([]);
        return;
    }

    const metrics = computeMetrics(workouts);
    streakDaysEl.textContent = String(metrics.streakDays);
    longestStreakEl.textContent = `${metrics.longestStreak} ${metrics.longestStreak === 1 ? 'day' : 'days'}`;
    averageMinutesEl.textContent = formatNum(metrics.averageMinutes, 'min');
    typicalMinutesEl.textContent = formatNum(metrics.typicalMinutes, 'min');
    averageCaloriesEl.textContent = formatNum(metrics.averageCalories);
    typicalCaloriesEl.textContent = formatNum(metrics.typicalCalories);
    renderMachineMix(workouts);
    showContentState();
}

function computeMetrics(workouts) {
    const workoutDays = buildWorkoutDaySet(workouts);
    const totalMinutes = workouts.reduce((sum, workout) => sum + ((workout.elapsedTimeSeconds ?? 0) / 60), 0);
    const totalCalories = workouts.reduce((sum, workout) => sum + (workout.calories ?? 0), 0);
    const workoutDayCount = workoutDays.size;

    return {
        streakDays: computeStreakDays(workoutDays),
        longestStreak: computeLongestStreak(workoutDays),
        averageMinutes: totalMinutes / LOOKBACK_DAYS,
        typicalMinutes: workoutDayCount > 0 ? totalMinutes / workoutDayCount : 0,
        averageCalories: totalCalories / LOOKBACK_DAYS,
        typicalCalories: workoutDayCount > 0 ? totalCalories / workoutDayCount : 0,
    };
}

function filterToLastNDays(workouts, days) {
    const start = getWindowStart(days);
    return workouts.filter((workout) => workout.timestamp instanceof Date && workout.timestamp >= start);
}

function getWindowStart(days) {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() - (days - 1));
    return end;
}

function buildWorkoutDaySet(workouts) {
    const daySet = new Set();
    for (const workout of workouts) {
        daySet.add(dateKey(workout.timestamp));
    }
    return daySet;
}

function computeStreakDays(workoutDays) {
    let count = 0;
    for (const key of workoutDays) {
        const prevKey = previousDayKey(key);
        if (workoutDays.has(prevKey)) count += 1;
    }
    return count;
}

function computeLongestStreak(workoutDays) {
    let longest = 0;
    let current = 0;
    const cursor = getWindowStart(LOOKBACK_DAYS);

    for (let i = 0; i < LOOKBACK_DAYS; i++) {
        const key = dateKey(cursor);
        if (workoutDays.has(key)) {
            current += 1;
            if (current > longest) longest = current;
        } else {
            current = 0;
        }
        cursor.setDate(cursor.getDate() + 1);
    }
    return longest;
}

function renderMachineMix(workouts) {
    const mix = machineMixCounts(workouts);
    const labels = [];
    const data = [];
    const colors = [];

    for (const type of MACHINE_ORDER) {
        const count = mix.get(type) || 0;
        if (count <= 0) continue;
        labels.push(type === 'unknown' ? 'Unknown' : machineTypeLabel(type));
        data.push(count);
        colors.push(machineTypeColor(type));
    }

    if (machineMixChart) machineMixChart.destroy();
    machineMixChart = new Chart(machineMixCanvas, {
        type: 'pie',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderColor: '#1a1d27',
                borderWidth: 1,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#9ca3b4' },
                },
            },
        },
    });
}

function machineMixCounts(workouts) {
    const counts = new Map();
    for (const workout of workouts) {
        const type = normalizeMachineType(workout.machineType) || 'unknown';
        counts.set(type, (counts.get(type) || 0) + 1);
    }
    return counts;
}

function showEmptyState() {
    emptyEl.classList.remove('hidden');
    contentEl.classList.add('hidden');
}

function showContentState() {
    emptyEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
}

function dateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function previousDayKey(key) {
    const parts = key.split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return '';
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    date.setTime(date.getTime() - DAY_MS);
    return dateKey(date);
}
