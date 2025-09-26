const admin = require("firebase-admin");
const config = require("./serviceAccountKey.json");

let firebaseApp;

const initializeFirebase = () => {
  if (!firebaseApp) {
    try {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(config),
      });

      console.log("Hey Dude !! Firebase Admin SDK initialized successfully");
    } catch (error) {
      console.error("Hey Dude !! Firebase initialization error:", error);
      throw new Error("Hey Dude !! Failed to initialize Firebase Admin SDK");
    }
  }

  return firebaseApp;
};

const getAuth = () => {
  const app = initializeFirebase();
  return admin.auth(app);
};

const getFirestore = () => {
  const app = initializeFirebase();
  return admin.firestore(app);
};

module.exports = {
  initializeFirebase,
  getAuth,
  getFirestore,
  admin,
};
