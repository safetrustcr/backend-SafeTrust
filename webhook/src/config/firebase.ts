import admin = require('firebase-admin');
import { initializeFirebaseAdmin } from './firebase-admin';

/**
 * Legacy compatibility shim.
 *
 * This module previously initialized Firebase Admin as a side effect of being
 * imported, using a projectId-only configuration that competed with
 * config/firebase-admin.ts. It now delegates to the single canonical
 * initializer so there is one code path and one set of credentials rules.
 */
// NOTE: Initialization is performed explicitly during application startup
// (see src/index.ts) so that failures can abort the boot sequence. This shim
// intentionally does NOT initialize Firebase as an import side effect.
export = admin;
