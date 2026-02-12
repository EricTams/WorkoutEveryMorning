import { extractWorkoutFromImage } from './llm.js';
import { saveWorkout } from './firebase.js';
import {
    readFileAsDataURL, resizeImage, extractPhotoDate, toDateInputValue,
    show, hide, formatDuration, formatPace, formatNum,
} from './utils.js';

// DOM refs (cached on init)
let photoInput, idleEl, loadingEl, resultEl, errorEl, savedEl;
let resultCard, errorMsg, dateInput;
let saveBtn, retakeBtn, retryBtn, logAnotherBtn;

// Holds the most recent extraction so Save can persist it
let pendingExtraction = null;

// --- Public API --------------------------------------------------------

export function initCapture() {
    photoInput = document.getElementById('photo-input');
    idleEl = document.getElementById('capture-idle');
    loadingEl = document.getElementById('capture-loading');
    resultEl = document.getElementById('capture-result');
    errorEl = document.getElementById('capture-error');
    savedEl = document.getElementById('capture-saved');
    resultCard = document.getElementById('result-card');
    errorMsg = document.getElementById('capture-error-msg');
    dateInput = document.getElementById('workout-date');

    saveBtn = document.getElementById('save-workout-btn');
    retakeBtn = document.getElementById('retake-btn');
    retryBtn = document.getElementById('error-retry-btn');
    logAnotherBtn = document.getElementById('log-another-btn');

    photoInput.addEventListener('change', onPhotoSelected);
    saveBtn.addEventListener('click', onSave);
    retakeBtn.addEventListener('click', resetToIdle);
    retryBtn.addEventListener('click', resetToIdle);
    logAnotherBtn.addEventListener('click', resetToIdle);
}

/**
 * Reset the capture screen back to the idle state.
 */
export function resetToIdle() {
    pendingExtraction = null;
    photoInput.value = '';
    showState(idleEl);
}

// --- Internal ----------------------------------------------------------

async function onPhotoSelected() {
    const file = photoInput.files?.[0];
    if (!file) return;

    showState(loadingEl);

    try {
        // Extract date from photo metadata in parallel with LLM call
        const [photoDate, dataURL] = await Promise.all([
            extractPhotoDate(file),
            readFileAsDataURL(file),
        ]);

        const resized = await resizeImage(dataURL);
        const extraction = await extractWorkoutFromImage(resized);
        pendingExtraction = extraction;
        dateInput.value = toDateInputValue(photoDate);
        renderResultCard(extraction);
        showState(resultEl);
    } catch (err) {
        console.error('Capture extraction failed:', err);
        errorMsg.textContent = err.message || 'Something went wrong. Try again.';
        showState(errorEl);
    }
}

async function onSave() {
    if (!pendingExtraction) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const workoutDate = dateInput.value
            ? new Date(dateInput.value + 'T12:00:00')
            : new Date();
        await saveWorkout(pendingExtraction, workoutDate);
        pendingExtraction = null;
        showState(savedEl);
    } catch (err) {
        console.error('Save failed:', err);
        errorMsg.textContent = `Save failed: ${err.message}`;
        showState(errorEl);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Workout';
    }
}

// --- UI helpers --------------------------------------------------------

const ALL_STATES = () => [idleEl, loadingEl, resultEl, errorEl, savedEl];

function showState(active) {
    for (const el of ALL_STATES()) {
        if (el === active) {
            show(el);
        } else {
            hide(el);
        }
    }
}

function renderResultCard(data) {
    resultCard.innerHTML = `
        <div class="card-header">
            <span class="machine-type">Workout</span>
        </div>
        <div class="card-fields">
            ${field('Duration', formatDuration(data.elapsedTimeSeconds))}
            ${field('Calories', formatNum(data.calories))}
            ${field('Distance', formatNum(data.distanceMiles, 'mi'))}
            ${field('Avg Speed', formatNum(data.avgSpeedMph, 'mph'))}
            ${field('Climbed', data.distanceClimbedFeet != null ? formatNum(data.distanceClimbedFeet, 'ft') : '--')}
            ${field('Pace', formatPace(data.avgPaceSecondsPerMile))}
            ${field('Heart Rate', data.avgHeartRate != null ? `${data.avgHeartRate} bpm` : '--')}
        </div>
    `;
}

function field(label, value) {
    return `
        <div class="field">
            <span class="field-label">${label}</span>
            <span class="field-value">${value}</span>
        </div>
    `;
}
