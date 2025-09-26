const { getFirestore } = require("./firebase-config");

const syncUserProfile = async (uid, userData = {}) => {
  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);
  const doc = await userRef.get();

  if (!doc.exists) {
    await userRef.set({
      uid,
      email: userData.email || null,
      name: userData.name || userData.displayName || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`Heyy Dude !! User profile created for UID: ${uid}`);
  }
};

module.exports = { syncUserProfile };
