import { FieldPath } from 'firebase-admin/firestore';
import { getAdminDb, parseArg } from './firestore-admin-client.mjs';

const COLLECTION = parseArg('collection', 'workouts');
const PAGE_SIZE = Number(parseArg('pageSize', '400'));

async function run() {
    const db = getAdminDb();
    const counts = new Map();

    let total = 0;
    let lastDocId = null;

    while (true) {
        let query = db.collection(COLLECTION).orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
        if (lastDocId) query = query.startAfter(lastDocId);

        const snapshot = await query.get();
        if (snapshot.empty) break;

        for (const doc of snapshot.docs) {
            total += 1;
            const value = normalizeMachineType(doc.get('machineType'));
            counts.set(value, (counts.get(value) || 0) + 1);
        }
        lastDocId = snapshot.docs[snapshot.docs.length - 1].id;
    }

    console.log(`Collection: ${COLLECTION}`);
    console.log(`Total docs: ${total}`);
    console.log('machineType distribution:');
    for (const [key, value] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${key}: ${value}`);
    }
}

function normalizeMachineType(raw) {
    if (raw == null || raw === '') return '(missing)';
    return String(raw);
}

run().catch((err) => {
    console.error('Report failed:', err.message);
    process.exitCode = 1;
});

