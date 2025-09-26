import express from 'express';
import { syncUser } from './user-sync.js';

const router = express.Router();

/**
 * Firebase webhook endpoint for user authentication events
 * This endpoint should be called by Firebase when user events occur
 */
router.post('/firebase-user-webhook', async (req, res) => {
  try {
    const { eventType, userData, customClaims } = req.body;
    
    // Validate required fields
    if (!eventType || !userData) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: eventType and userData'
      });
    }
    
    // Prepare additional data
    const additionalData = {
      customClaims: customClaims || {},
      role: customClaims?.role || 'user'
    };
    
    // Sync user to database
    const syncResult = await syncUser(userData, eventType, additionalData);
    
    if (syncResult.success) {
      return res.json({
        success: true,
        message: 'User synced successfully',
        data: syncResult.user
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Failed to sync user',
        error: syncResult.error
      });
    }
    
  } catch (error) {
    console.error('Firebase webhook error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * Manual user sync endpoint for testing or manual operations
 */
router.post('/sync-user', async (req, res) => {
  try {
    const { firebaseUser, eventType = 'updated', additionalData = {} } = req.body;
    
    if (!firebaseUser) {
      return res.status(400).json({
        success: false,
        message: 'firebaseUser is required'
      });
    }
    
    const syncResult = await syncUser(firebaseUser, eventType, additionalData);
    
    return res.json(syncResult);
    
  } catch (error) {
    console.error('Manual sync error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * Get user sync status endpoint
 */
router.get('/sync-status/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email parameter is required'
      });
    }
    
    // This would typically query the database to check sync status
    // For now, return a placeholder response
    return res.json({
      success: true,
      email: email,
      synced: true,
      lastSync: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Sync status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

export default router;
