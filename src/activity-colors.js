const ACTIVITY_COLORS = [
    '#34d399', // emerald
    '#22d3ee', // cyan
    '#38bdf8', // sky
    '#60a5fa', // blue
    '#818cf8', // indigo
    '#a78bfa', // violet
];

export function getActivityColor(activityName) {
    const key = String(activityName || '').trim().toLowerCase();
    if (!key) return ACTIVITY_COLORS[0];
    const idx = hashString(key) % ACTIVITY_COLORS.length;
    return ACTIVITY_COLORS[idx];
}

function hashString(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}
