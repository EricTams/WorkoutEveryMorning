import { FIREBASE_CONFIG, FIRESTORE_COLLECTION, HEALTH_COLLECTION } from './config.js';
import { getUsername } from './setup.js';
import { resolveMachineType } from './machineType.js';

let db = null;
let firebaseReady = false;

// --- Init --------------------------------------------------------------

/**
 * Initialize Firebase and Firestore. Safe to call multiple times.
 */
export function initFirebase() {
    if (firebaseReady) return;

    if (typeof firebase === 'undefined' || !firebase.apps) {
        console.warn('Firebase SDK not loaded — online features disabled');
        return;
    }

    if (!FIREBASE_CONFIG.projectId) {
        console.warn('Firebase config not set — online features disabled');
        return;
    }

    try {
        if (firebase.apps.length === 0) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }
        db = firebase.firestore();
        firebaseReady = true;
        console.log('Firebase initialized');
    } catch (err) {
        console.error('Firebase init failed:', err.message);
    }
}

export function isFirebaseReady() {
    return firebaseReady;
}

// --- Write -------------------------------------------------------------

/**
 * Save a workout document to Firestore.
 * @param {object} extraction - fields extracted by the LLM
 * @param {Date} workoutDate - the date of the workout
 * @param {string|null} machineTypeOverride - selected machine type override
 * @returns {Promise<string>} The new document ID
 */
export async function saveWorkout(extraction, workoutDate, machineTypeOverride = null) {
    ensureReady();
    const username = getUsername();
    if (!username) throw new Error('No username set');
    const machineType = resolveMachineType(extraction, machineTypeOverride);

    const doc = {
        username,
        machineType,
        timestamp: firebase.firestore.Timestamp.fromDate(workoutDate),
        elapsedTimeSeconds: extraction.elapsedTimeSeconds ?? 0,
        calories: extraction.calories ?? 0,
        distanceMiles: extraction.distanceMiles ?? 0,
        distanceClimbedFeet: extraction.distanceClimbedFeet ?? null,
        avgSpeedMph: extraction.avgSpeedMph ?? 0,
        avgPaceSecondsPerMile: extraction.avgPaceSecondsPerMile ?? null,
        avgHeartRate: extraction.avgHeartRate ?? null,
        rawExtraction: extraction,
    };

    const ref = await db.collection(FIRESTORE_COLLECTION).add(doc);
    return ref.id;
}

// --- Read --------------------------------------------------------------

/**
 * Query workouts for the current user, optionally filtered by date range.
 * @param {Date|null} since - only return workouts after this date (null = all)
 * @returns {Promise<Array>} Workout documents sorted newest-first
 */
export async function queryWorkouts(since) {
    ensureReady();
    const username = getUsername();
    if (!username) return [];

    let query = db
        .collection(FIRESTORE_COLLECTION)
        .where('username', '==', username)
        .orderBy('timestamp', 'desc');

    if (since) {
        query = query.where('timestamp', '>=', since);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        // Convert Firestore Timestamp to JS Date for convenience
        timestamp: doc.data().timestamp?.toDate() ?? new Date(),
    }));
}

/**
 * Get a health measurement record for the current user and given day.
 * @param {Date} dayDate
 * @returns {Promise<object|null>}
 */
export async function queryHealthByDate(dayDate) {
    ensureReady();
    const username = getUsername();
    if (!username) return null;

    const dayKey = toDayKey(dayDate);
    const ref = db.collection(HEALTH_COLLECTION).doc(healthDocId(username, dayKey));
    const snapshot = await ref.get();
    if (!snapshot.exists) return null;
    return toHealthRecord(snapshot);
}

/**
 * Upsert the current user's health measurements for a day.
 * New metric keys are added and existing keys are overwritten.
 * @param {Date} dayDate
 * @param {object} resolvedMetrics
 * @param {object|null} reviewMeta
 * @returns {Promise<string>} Document ID
 */
export async function saveOrMergeHealthMeasurement(dayDate, resolvedMetrics, reviewMeta = null) {
    ensureReady();
    const username = getUsername();
    if (!username) throw new Error('No username set');

    const dayKey = toDayKey(dayDate);
    const docId = healthDocId(username, dayKey);
    const ref = db.collection(HEALTH_COLLECTION).doc(docId);

    const normalized = normalizeMeasurements(resolvedMetrics);
    const capturedAt = firebase.firestore.Timestamp.fromDate(new Date());
    await db.runTransaction(async (tx) => {
        const existingSnapshot = await tx.get(ref);
        const existingData = existingSnapshot.exists ? existingSnapshot.data() : null;
        const existingMeasurements = existingData?.measurements || {};

        const addedKeys = [];
        const updatedKeys = [];
        for (const key of Object.keys(normalized)) {
            if (!(key in existingMeasurements)) {
                addedKeys.push(key);
                continue;
            }
            if (existingMeasurements[key] !== normalized[key]) {
                updatedKeys.push(key);
            }
        }

        const nextMeasurements = {
            ...existingMeasurements,
            ...normalized,
        };

        const source = {
            capturedAt,
            addedKeys,
            updatedKeys,
            reviewMeta: reviewMeta || null,
        };

        tx.set(ref, {
            username,
            dayKey,
            timestamp: capturedAt,
            measurements: nextMeasurements,
            sources: firebase.firestore.FieldValue.arrayUnion(source),
        }, { merge: true });
    });

    return docId;
}

/**
 * Query health records for current user sorted newest-first.
 * @param {Date|null} since
 * @returns {Promise<Array>}
 */
export async function queryHealthMeasurements(since) {
    ensureReady();
    const username = getUsername();
    if (!username) return [];

    let query = db
        .collection(HEALTH_COLLECTION)
        .where('username', '==', username)
        .orderBy('timestamp', 'desc');

    if (since) {
        query = query.where('timestamp', '>=', since);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => toHealthRecord(doc));
}

// --- Helpers -----------------------------------------------------------

function ensureReady() {
    if (!firebaseReady) {
        throw new Error('Firebase is not initialized');
    }
}

function toHealthRecord(doc) {
    const data = doc.data();
    return {
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate() ?? new Date(),
    };
}

function toDayKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        throw new Error('Invalid health measurement date');
    }
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function healthDocId(username, dayKey) {
    return `${encodeURIComponent(username)}__${dayKey}`;
}

function normalizeMeasurements(measurements) {
    if (!measurements || typeof measurements !== 'object') {
        throw new Error('Health measurements must be an object');
    }
    const output = {};
    for (const [key, value] of Object.entries(measurements)) {
        if (!key) continue;
        if (value == null) {
            output[key] = null;
            continue;
        }
        const num = Number(value);
        if (Number.isNaN(num)) {
            throw new Error(`Measurement "${key}" must be numeric or null`);
        }
        output[key] = num;
    }
    return output;
}
