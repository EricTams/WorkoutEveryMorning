import { FieldPath } from 'firebase-admin/firestore';
import { getAdminDb, parseArg, hasFlag } from './firestore-admin-client.mjs';

const COLLECTION = parseArg('collection', 'workouts');
const TARGET_MACHINE_TYPE = parseArg('value', 'eliptical');
const PAGE_SIZE = Number(parseArg('pageSize', '300'));
const DRY_RUN = hasFlag('dry-run');

async function run() {
    const db = getAdminDb();
    console.log(
        `${DRY_RUN ? '[DRY RUN] ' : ''}Updating "${COLLECTION}" machineType -> "${TARGET_MACHINE_TYPE}"`,
    );

    let lastDocId = null;
    let scanned = 0;
    let updated = 0;
    let unchanged = 0;

    while (true) {
        let query = db.collection(COLLECTION).orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
        if (lastDocId) query = query.startAfter(lastDocId);

        const snapshot = await query.get();
        if (snapshot.empty) break;

        const batch = db.batch();
        let batchUpdates = 0;

        for (const doc of snapshot.docs) {
            scanned += 1;
            const current = doc.get('machineType');

            if (current === TARGET_MACHINE_TYPE) {
                unchanged += 1;
                continue;
            }

            updated += 1;
            batchUpdates += 1;
            if (!DRY_RUN) {
                batch.update(doc.ref, { machineType: TARGET_MACHINE_TYPE });
            }
        }

        if (!DRY_RUN && batchUpdates > 0) {
            await batch.commit();
        }

        lastDocId = snapshot.docs[snapshot.docs.length - 1].id;
    }

    console.log(`Scanned: ${scanned}`);
    console.log(`Needs update: ${updated}`);
    console.log(`Already correct: ${unchanged}`);
    if (DRY_RUN) {
        console.log('Dry run complete. No writes were performed.');
    } else {
        console.log('Migration complete.');
    }
}

run().catch((err) => {
    console.error('Machine type migration failed:', err.message);
    process.exitCode = 1;
});

