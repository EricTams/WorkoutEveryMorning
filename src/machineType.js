export const MACHINE_TYPES = {
    ELIPTICAL: 'eliptical',
    TREADMILL: 'treadmill',
    CYCLE: 'cycle',
    HIKING: 'hiking',
};

export const MACHINE_TYPE_COLORS = {
    [MACHINE_TYPES.ELIPTICAL]: '#f59e0b',
    [MACHINE_TYPES.TREADMILL]: '#f7e8b4',
    [MACHINE_TYPES.CYCLE]: '#f2c46d',
    [MACHINE_TYPES.HIKING]: '#c2410c',
    unknown: '#6b7280',
};

const NORMALIZED_TYPE_MAP = {
    eliptical: MACHINE_TYPES.ELIPTICAL,
    elliptical: MACHINE_TYPES.ELIPTICAL,
    cross_trainer: MACHINE_TYPES.ELIPTICAL,
    crosstrainer: MACHINE_TYPES.ELIPTICAL,
    treadmill: MACHINE_TYPES.TREADMILL,
    run: MACHINE_TYPES.TREADMILL,
    running: MACHINE_TYPES.TREADMILL,
    walk: MACHINE_TYPES.TREADMILL,
    walking: MACHINE_TYPES.TREADMILL,
    cycle: MACHINE_TYPES.CYCLE,
    cycling: MACHINE_TYPES.CYCLE,
    bike: MACHINE_TYPES.CYCLE,
    bicycle: MACHINE_TYPES.CYCLE,
    spin: MACHINE_TYPES.CYCLE,
    spinning: MACHINE_TYPES.CYCLE,
    hiking: MACHINE_TYPES.HIKING,
    hike: MACHINE_TYPES.HIKING,
};

const MACHINE_TYPE_LABELS = {
    [MACHINE_TYPES.ELIPTICAL]: 'Eliptical',
    [MACHINE_TYPES.TREADMILL]: 'Treadmill',
    [MACHINE_TYPES.CYCLE]: 'Cycle',
    [MACHINE_TYPES.HIKING]: 'Hiking',
};

export function normalizeMachineType(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return NORMALIZED_TYPE_MAP[normalized] ?? null;
}

export function guessMachineType(extraction) {
    if (!extraction || typeof extraction !== 'object') {
        return MACHINE_TYPES.TREADMILL;
    }

    const pace = toNumberOrNull(extraction.avgPaceSecondsPerMile);
    if (pace != null && pace > 0) {
        return MACHINE_TYPES.TREADMILL;
    }

    const speed = toNumberOrNull(extraction.avgSpeedMph);
    const climbed = toNumberOrNull(extraction.distanceClimbedFeet);
    if (speed != null && speed >= 12) {
        return MACHINE_TYPES.CYCLE;
    }
    if (speed != null && speed >= 8 && climbed == null) {
        return MACHINE_TYPES.CYCLE;
    }
    if (climbed != null && climbed > 0) {
        return MACHINE_TYPES.ELIPTICAL;
    }

    return MACHINE_TYPES.TREADMILL;
}

export function resolveMachineType(extraction, overrideValue = null) {
    const overrideType = normalizeMachineType(overrideValue);
    if (overrideType) return overrideType;

    const extractedType = normalizeMachineType(extraction?.machineType);
    if (extractedType) return extractedType;

    return guessMachineType(extraction);
}

export function machineTypeLabel(value, fallbackLabel = 'Workout') {
    const type = normalizeMachineType(value);
    return type ? MACHINE_TYPE_LABELS[type] : fallbackLabel;
}

export function machineTypeColor(value) {
    const type = normalizeMachineType(value);
    return MACHINE_TYPE_COLORS[type || 'unknown'];
}

function toNumberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
