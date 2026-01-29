# Firebase Project Setup: SafeTrust

This document outlines the setup and configuration of the Firebase project for the SafeTrust platform.

## Project Details

- **Project Name:** SafeTrust
- **Project ID:** `safetrust-890d0`
- **Project Console URL:** [https://console.firebase.google.com/u/0/project/safetrust-890d0](https://console.firebase.google.com/u/0/project/safetrust-890d0)

## Authentication

The following authentication providers are enabled for the project:

- **Email/Password:** Allows users to sign up and sign in with their email address and a password.
- **Google OAuth:** Enables users to authenticate using their Google accounts.

## Service Account

A service account has been created to allow the backend server to interact with Firebase services securely.

- **Service Account Key File:** The private key for the service account is stored in a JSON file.
  - **File Name:** `safetrust-890d0-firebase-adminsdk-fbsvc-3d69c4de99.json`
  - **Location:** The file is located in the `config/` directory of the backend project.

### Security Note

**IMPORTANT:** The service account key file contains sensitive credentials and provides administrative access to the Firebase project. It is critical to keep this file secure.

- The file path `config/safetrust-890d0-firebase-adminsdk-fbsvc-3d69c4de99.json` has been added to the `.gitignore` file to prevent it from being accidentally committed to the Git repository.
- **Do not** commit this file to version control or expose it publicly.

## Backend Integration

The Firebase Admin SDK for Node.js is used in the backend to manage users and perform other administrative tasks.

- **Installation:** The SDK is added as a project dependency:
  ```bash
  npm install firebase-admin
  ```

- **Initialization:** The SDK is initialized when the application starts. The initialization code is located in `services/firebase/firebase.mjs`. It uses the service account key from the `config/` directory to authenticate.

  ```javascript
  // services/firebase/firebase.mjs
  import admin from 'firebase-admin';
  import { readFileSync } from 'fs';
  import path from 'path';

  const serviceAccount = JSON.parse(readFileSync(path.resolve('config/safetrust-890d0-firebase-adminsdk-fbsvc-3d69c4de99.json')));

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  export default admin;
  ```

This setup allows the backend to securely communicate with Firebase for tasks such as verifying ID tokens and managing user data.
