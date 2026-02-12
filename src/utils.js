import { IMAGE_MAX_DIMENSION } from './config.js';

/**
 * Format seconds as "MM:SS" or "H:MM:SS" for display.
 */
export function formatDuration(totalSeconds) {
    if (totalSeconds == null) return '--';
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.round(totalSeconds % 60);
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Format a pace in seconds-per-mile as "M:SS / mi".
 */
export function formatPace(secondsPerMile) {
    if (secondsPerMile == null) return '--';
    const m = Math.floor(secondsPerMile / 60);
    const s = Math.round(secondsPerMile % 60);
    return `${m}:${String(s).padStart(2, '0')} / mi`;
}

/**
 * Format a number with up to 2 decimal places, stripping trailing zeros.
 */
export function formatNum(value, unit) {
    if (value == null) return '--';
    const formatted = Number(value).toFixed(2).replace(/\.?0+$/, '');
    return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Read a File as a data URL (base64 string).
 */
export function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

/**
 * Resize an image (data URL) so its largest dimension is at most maxDim px.
 * Returns a new JPEG data URL.
 */
export function resizeImage(dataURL, maxDim = IMAGE_MAX_DIMENSION) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            if (width <= maxDim && height <= maxDim) {
                resolve(dataURL);
                return;
            }
            const scale = maxDim / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => reject(new Error('Failed to load image for resize'));
        img.src = dataURL;
    });
}

/**
 * Show an element by removing the "hidden" class.
 */
export function show(el) {
    el.classList.remove('hidden');
}

/**
 * Hide an element by adding the "hidden" class.
 */
export function hide(el) {
    el.classList.add('hidden');
}

/**
 * Return a Date N days in the past (start of that day).
 */
export function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * Try to extract the DateTimeOriginal from JPEG EXIF metadata.
 * Falls back to File.lastModified, then to current date.
 * @param {File} file
 * @returns {Promise<Date>}
 */
export async function extractPhotoDate(file) {
    try {
        const exifDate = await readExifDate(file);
        if (exifDate) return exifDate;
    } catch {
        // EXIF parsing failed, fall through
    }
    // Fallback: file's lastModified timestamp (usually capture time on phones)
    if (file.lastModified) {
        return new Date(file.lastModified);
    }
    return new Date();
}

/**
 * Format a Date as "YYYY-MM-DD" for <input type="date"> value.
 */
export function toDateInputValue(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// --- EXIF date parser (minimal, JPEG only) -----------------------------

const EXIF_DATE_ORIGINAL_TAG = 0x9003;
const EXIF_DATE_TAG = 0x0132;

/**
 * Minimal EXIF parser that only reads DateTimeOriginal or DateTime.
 * Returns a Date or null.
 */
function readExifDate(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                resolve(parseExifDate(reader.result));
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        // Only need the first 128KB for EXIF
        const slice = file.slice(0, 131072);
        reader.readAsArrayBuffer(slice);
    });
}

function parseExifDate(buffer) {
    const view = new DataView(buffer);
    // Verify JPEG SOI marker
    if (view.getUint16(0) !== 0xFFD8) return null;

    let offset = 2;
    while (offset < view.byteLength - 2) {
        const marker = view.getUint16(offset);
        offset += 2;
        // APP1 marker (EXIF)
        if (marker === 0xFFE1) {
            return parseApp1(view, offset);
        }
        // Skip other markers
        if (marker === 0xFFDA) break; // Start of scan, stop
        const segLen = view.getUint16(offset);
        offset += segLen;
    }
    return null;
}

function parseApp1(view, offset) {
    const segLen = view.getUint16(offset);
    const exifStart = offset + 2;
    // Check "Exif\0\0" header
    if (view.getUint32(exifStart) !== 0x45786966 || view.getUint16(exifStart + 4) !== 0x0000) {
        return null;
    }
    const tiffStart = exifStart + 6;
    const byteOrder = view.getUint16(tiffStart);
    const le = byteOrder === 0x4949; // little-endian

    const get16 = (o) => view.getUint16(o, le);
    const get32 = (o) => view.getUint32(o, le);

    // IFD0
    const ifd0Offset = tiffStart + get32(tiffStart + 4);
    const dateStr = findDateInIFD(view, ifd0Offset, tiffStart, get16, get32, segLen);
    if (dateStr) return exifStringToDate(dateStr);

    // Try ExifIFD (sub-IFD pointer, tag 0x8769)
    const exifIFDOffset = findTagValue(view, ifd0Offset, tiffStart, 0x8769, get16, get32);
    if (exifIFDOffset) {
        const dateStr2 = findDateInIFD(view, tiffStart + exifIFDOffset, tiffStart, get16, get32, segLen);
        if (dateStr2) return exifStringToDate(dateStr2);
    }
    return null;
}

function findDateInIFD(view, ifdOffset, tiffStart, get16, get32, maxLen) {
    const count = get16(ifdOffset);
    for (let i = 0; i < count; i++) {
        const entryOffset = ifdOffset + 2 + i * 12;
        if (entryOffset + 12 > tiffStart + maxLen) break;
        const tag = get16(entryOffset);
        if (tag === EXIF_DATE_ORIGINAL_TAG || tag === EXIF_DATE_TAG) {
            const valueOffset = tiffStart + get32(entryOffset + 8);
            return readAscii(view, valueOffset, 19);
        }
    }
    return null;
}

function findTagValue(view, ifdOffset, tiffStart, targetTag, get16, get32) {
    const count = get16(ifdOffset);
    for (let i = 0; i < count; i++) {
        const entryOffset = ifdOffset + 2 + i * 12;
        const tag = get16(entryOffset);
        if (tag === targetTag) return get32(entryOffset + 8);
    }
    return null;
}

function readAscii(view, offset, len) {
    let str = '';
    for (let i = 0; i < len && offset + i < view.byteLength; i++) {
        const c = view.getUint8(offset + i);
        if (c === 0) break;
        str += String.fromCharCode(c);
    }
    return str;
}

function exifStringToDate(str) {
    // EXIF format: "YYYY:MM:DD HH:MM:SS"
    const match = str.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, y, mo, d, h, mi, s] = match;
    return new Date(+y, +mo - 1, +d, +h, +mi, +s);
}
