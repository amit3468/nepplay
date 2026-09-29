// scripts/reschedule.js
// One-time migration: move all 2026-09-30 tournaments → 2026-10-01
// Skips Free Fire 1v1.  Run:  npm run reschedule

const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const OLD_DATE = "2026-09-30";
const NEW_DATE = "2026-10-01";
const EXCLUDE_TITLES = ["Free Fire 1v1"];

async function reschedule() {
  const snap = await db.collection("tournaments").get();

  if (snap.empty) {
    console.log("No tournaments found.");
    return;
  }

  const batch = db.batch();
  let moved = 0;
  let skipped = 0;
  let untouched = 0;

  snap.forEach((doc) => {
    const data = doc.data();
    const currentDate = data.date || data.scheduledDate;

    if (currentDate !== OLD_DATE) {
      untouched++;
      return;
    }

    if (EXCLUDE_TITLES.includes(data.title)) {
      console.log(`⏭️  Skipped: ${data.title} (${doc.id})`);
      skipped++;
      return;
    }

    batch.update(doc.ref, {
      date: NEW_DATE,
      scheduledDate: NEW_DATE,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ Moved: ${data.title} (${doc.id}) → ${NEW_DATE}`);
    moved++;
  });

  await batch.commit();
  console.log(`\nDone. Moved: ${moved} | Skipped: ${skipped} | Not on 30-Sep: ${untouched}`);
}

reschedule().catch((err) => {
  console.error("❌ Reschedule failed:", err);
  process.exit(1);
});
