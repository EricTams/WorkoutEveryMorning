export function toMetricKey(rawName) {
    return String(rawName || '')
        .trim()
        .replace(/\s+/g, ' ');
}
