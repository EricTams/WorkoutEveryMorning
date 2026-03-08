import { queryStretches, saveStretch } from './firebase.js';
import { refreshDashboard } from './dashboard.js';

const STRETCH_SETS = [
    {
        label: 'Set A',
        exercises: [
            { name: 'Split Leg Hamstring Stretch', desc: 'Front leg straight, hinge forward at hips to stretch hamstrings.' },
            { name: 'Deficit Pushup', desc: 'Hands elevated, lower chest below hands to open chest shoulders.' },
            { name: 'Half Kneeling Half Windmill', desc: 'Half kneeling, one arm overhead, hinge and rotate torso toward front leg.' },
        ],
    },
    {
        label: 'Set B',
        exercises: [
            { name: 'Front Foot Elevated Split Squat Hold', desc: 'Front foot elevated, drop hips down holding stretch through hips.' },
            { name: 'Seated Face Pull', desc: 'Pull band or cable toward face, squeeze shoulder blades together.' },
            { name: '90/90 Pelvic Tilt', desc: 'Feet on wall, lightly pull heels downward engaging hamstrings tilting pelvis.' },
        ],
    },
    {
        label: 'Set C',
        exercises: [
            { name: 'TRX Assist Cossack Squat', desc: 'Hold straps, squat sideways deep into one hip stretch.' },
            { name: 'Bench Lat Stretch', desc: 'Kneel, elbows on bench, sink chest down stretching lats shoulders.' },
            { name: 'Half Kneeling Half Windmill', desc: 'Half kneeling, arm overhead, hinge and rotate torso toward front leg.' },
        ],
    },
];

let nextLabelEl, exerciseListEl, dateInput, saveBtn, savedEl, idleEl;
let saveDefaultText = 'Mark Complete';

export function initStretching() {
    nextLabelEl = document.getElementById('stretch-next-label');
    exerciseListEl = document.getElementById('stretch-exercise-list');
    dateInput = document.getElementById('stretch-date');
    saveBtn = document.getElementById('stretch-save-btn');
    savedEl = document.getElementById('stretch-saved');
    idleEl = document.getElementById('stretch-idle');

    saveBtn?.addEventListener('click', onSave);
    document.getElementById('stretch-another-btn')?.addEventListener('click', resetToIdle);
}

export async function refreshStretching() {
    resetToIdle();
    try {
        const stretches = await queryStretches(null);
        const nextIndex = stretches.length > 0
            ? (stretches[0].setIndex + 1) % STRETCH_SETS.length
            : 0;
        renderSet(nextIndex);
    } catch (err) {
        console.error('Failed to load stretch data:', err);
        renderSet(0);
    }
}

function renderSet(index) {
    const set = STRETCH_SETS[index];
    if (!nextLabelEl || !exerciseListEl) return;

    nextLabelEl.textContent = `Next Up: ${set.label}`;
    nextLabelEl.dataset.setIndex = String(index);

    exerciseListEl.innerHTML = set.exercises.map((ex) => `
        <div class="stretch-exercise-card">
            <span class="stretch-exercise-name">${escapeHtml(ex.name)}</span>
            <span class="stretch-exercise-desc">${escapeHtml(ex.desc)}</span>
        </div>
    `).join('');

    if (dateInput) {
        dateInput.value = toDateInputValue(new Date());
    }
}

async function onSave() {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
        const setIndex = Number(nextLabelEl.dataset.setIndex);
        const stretchDate = dateInput.value
            ? new Date(dateInput.value + 'T12:00:00')
            : new Date();
        if (Number.isNaN(stretchDate.getTime())) throw new Error('Invalid date');

        await saveStretch(setIndex, stretchDate);
        showSaved();
        refreshDashboard();
    } catch (err) {
        console.error('Failed to save stretch:', err);
        alert(err.message || 'Failed to save stretch');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = saveDefaultText;
    }
}

function showSaved() {
    if (idleEl) idleEl.classList.add('hidden');
    if (savedEl) savedEl.classList.remove('hidden');
}

function resetToIdle() {
    if (idleEl) idleEl.classList.remove('hidden');
    if (savedEl) savedEl.classList.add('hidden');
}

function toDateInputValue(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
