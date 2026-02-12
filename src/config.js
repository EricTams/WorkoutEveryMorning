// AIDEV-NOTE: Central configuration. Firebase config must be filled in after
// creating the Firebase project (see setup-firebase-project todo).

export const STORAGE_KEYS = {
    username: 'wem_username',
    apiKey: 'wem_openai_key',
};

export const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
export const OPENAI_MODEL = 'gpt-5.2';

export const FIRESTORE_COLLECTION = 'workouts';

export const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCloRCnxs_2QnXW6ceJysWbcfCt7RAJ5RM',
    authDomain: 'workout-every-morning.firebaseapp.com',
    projectId: 'workout-every-morning',
    storageBucket: 'workout-every-morning.firebasestorage.app',
    messagingSenderId: '778312771533',
    appId: '1:778312771533:web:d208fbb2f73aa8258b0684',
};

// Image resize target (max dimension in px) before sending to LLM
export const IMAGE_MAX_DIMENSION = 1024;
