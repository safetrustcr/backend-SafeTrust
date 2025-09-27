import admin from "firebase-admin";
import config from "./serviceAccountKey.json" assert { type: "json" };

let firebaseApp;

export const initializeFirebase = () => {
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

export const getAuth = () => {
  const app = initializeFirebase();
  return admin.auth(app);
};

export const getFirestore = () => {
  const app = initializeFirebase();
  return admin.firestore(app);
};
