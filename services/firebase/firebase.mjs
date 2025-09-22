import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import path from 'path';

const serviceAccount = JSON.parse(readFileSync(path.resolve('config/safetrust-890d0-firebase-adminsdk-fbsvc-3d69c4de99.json')));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

export default admin;
