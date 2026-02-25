import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const SERVICE_ACCOUNT_ENV = 'FIREBASE_SERVICE_ACCOUNT_PATH';

export function getAdminDb() {
    const serviceAccountPath = process.env[SERVICE_ACCOUNT_ENV];
    if (!serviceAccountPath) {
        throw new Error(
            `Missing ${SERVICE_ACCOUNT_ENV}. Set it to your Firebase service account JSON path.`,
        );
    }

    const resolvedPath = path.resolve(serviceAccountPath);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Service account file not found: ${resolvedPath}`);
    }

    const serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    const app = getApps()[0] || initializeApp({
        credential: cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
    });

    return getFirestore(app);
}

export function parseArg(name, fallback = null) {
    const prefix = `--${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : fallback;
}

export function hasFlag(flagName) {
    return process.argv.includes(`--${flagName}`);
}

