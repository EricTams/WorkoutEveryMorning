import { FieldPath } from 'firebase-admin/firestore';
import { getAdminDb, parseArg } from './firestore-admin-client.mjs';

const SOURCE_COLLECTION = parseArg('source', 'workouts');
const TARGET_COLLECTION = parseArg('target', `${SOURCE_COLLECTION}_backup_${timestamp()}`);
const PAGE_SIZE = Number(parseArg('pageSize', '300'));

async function run() {
    const db = getAdminDb();
    console.log(`Backing up "${SOURCE_COLLECTION}" -> "${TARGET_COLLECTION}"`);

    let totalCopied = 0;
    let lastDocId = null;
    let page = 0;

    while (true) {
        let query = db
            .collection(SOURCE_COLLECTION)
            .orderBy(FieldPath.documentId())
            .limit(PAGE_SIZE);

        if (lastDocId) query = query.startAfter(lastDocId);

        const snapshot = await query.get();
        if (snapshot.empty) break;

        const batch = db.batch();
        for (const doc of snapshot.docs) {
            batch.set(db.collection(TARGET_COLLECTION).doc(doc.id), doc.data());
        }
        await batch.commit();

        page += 1;
        totalCopied += snapshot.size;
        lastDocId = snapshot.docs[snapshot.docs.length - 1].id;
        console.log(`Copied page ${page}: ${snapshot.size} docs (total ${totalCopied})`);
    }

    console.log(`Backup complete. Copied ${totalCopied} docs.`);
    console.log(`Backup collection: ${TARGET_COLLECTION}`);
}

function timestamp() {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    const s = String(d.getUTCSeconds()).padStart(2, '0');
    return `${y}${m}${day}_${h}${min}${s}Z`;
}

run().catch((err) => {
    console.error('Backup failed:', err.message);
    process.exitCode = 1;
});

