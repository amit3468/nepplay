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

  snap.forEach((doc) => {
    const data = doc.data();
    const currentDate = data.date || data.scheduledDate;
    if (currentDate !== OLD_DATE) return;

    if (EXCLUDE_TITLES.includes(data.title)) {
      console.log("Skipped: " + data.title);
      skipped++;
      return;
    }

    batch.update(doc.ref, {
      date: NEW_DATE,
      scheduledDate: NEW_DATE,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log("Moved: " + data.title + " -> " + NEW_DATE);
    moved++;
  });

  await batch.commit();
  console.log("Done. Moved: " + moved + " | Skipped: " + skipped);
}

reschedule().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});