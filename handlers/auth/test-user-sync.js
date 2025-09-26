import { syncUser, syncUserToDatabase, handleUserCreation, handleUserUpdates, resolveUserConflicts, validateSyncData } from './user-sync.js';

// Example Firebase user object
const exampleFirebaseUser = {
  uid: 'firebase-user-123',
  email: 'test@example.com',
  displayName: 'John Doe',
  phoneNumber: '+1234567890',
  photoURL: 'https://example.com/photo.jpg',
  metadata: {
    creationTime: '2024-01-01T00:00:00Z',
    lastSignInTime: '2024-01-15T12:00:00Z'
  }
};

// Example additional data with custom claims
const exampleAdditionalData = {
  customClaims: {
    role: 'admin',
    permissions: ['read', 'write', 'delete']
  },
  role: 'admin'
};

/**
 * Test function to demonstrate user sync functionality
 */
async function testUserSync() {
  console.log('Testing User Database Synchronization...\n');
  
  // Test 1: Validate sync data
  console.log('1. Testing data validation:');
  const validation = validateSyncData(exampleFirebaseUser, exampleAdditionalData);
  console.log('Validation result:', validation);
  console.log('');
  
  // Test 2: Sync user to database
  console.log('2. Testing user sync to database:');
  const syncResult = await syncUserToDatabase(exampleFirebaseUser, exampleAdditionalData);
  console.log('Sync result:', syncResult);
  console.log('');
  
  // Test 3: Handle user creation
  console.log('3. Testing user creation:');
  const creationResult = await handleUserCreation(exampleFirebaseUser, exampleAdditionalData);
  console.log('Creation result:', creationResult);
  console.log('');
  
  // Test 4: Handle user updates
  console.log('4. Testing user updates:');
  const updateResult = await handleUserUpdates(exampleFirebaseUser, exampleAdditionalData);
  console.log('Update result:', updateResult);
  console.log('');
  
  // Test 5: Main sync function
  console.log('5. Testing main sync function:');
  const mainSyncResult = await syncUser(exampleFirebaseUser, 'created', exampleAdditionalData);
  console.log('Main sync result:', mainSyncResult);
  console.log('');
  
  console.log('User sync testing completed!');
}

/**
 * Test function for conflict resolution
 */
async function testConflictResolution() {
  console.log('Testing Conflict Resolution...\n');
  
  const conflictingUser = {
    uid: 'different-uid-456',
    email: 'test@example.com', // Same email, different UID
    displayName: 'Jane Smith',
    phoneNumber: '+0987654321',
    metadata: {
      creationTime: '2024-01-02T00:00:00Z',
      lastSignInTime: '2024-01-16T12:00:00Z'
    }
  };
  
  const existingUser = {
    id: 'firebase-user-123',
    email: 'test@example.com',
    first_name: 'John',
    last_name: 'Doe'
  };
  
  const conflictResult = await resolveUserConflicts(conflictingUser, existingUser, exampleAdditionalData);
  console.log('Conflict resolution result:', conflictResult);
}

// Export test functions for use in other modules
export { testUserSync, testConflictResolution };

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testUserSync()
    .then(() => testConflictResolution())
    .catch(console.error);
}
