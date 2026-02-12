import { FIREBASE_CONFIG, FIRESTORE_COLLECTION } from './config.js';
import { getUsername } from './setup.js';

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
 * @returns {Promise<string>} The new document ID
 */
export async function saveWorkout(extraction, workoutDate) {
    ensureReady();
    const username = getUsername();
    if (!username) throw new Error('No username set');

    const doc = {
        username,
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

// --- Helpers -----------------------------------------------------------

function ensureReady() {
    if (!firebaseReady) {
        throw new Error('Firebase is not initialized');
    }
}
