import express from 'express';
import { verifyFirebaseToken, protectRoute } from './auth-middleware.js';

const router = express.Router();

/**
 * Example protected route using middleware directly
 */
router.get('/profile', verifyFirebaseToken, (req, res) => {
  res.json({
    success: true,
    message: 'Profile data retrieved successfully',
    user: req.user,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Example protected route using the wrapper function
 */
router.get('/dashboard', protectRoute(), (req, res) => {
  res.json({
    success: true,
    message: 'Dashboard data',
    user: {
      uid: req.user.uid,
      email: req.user.email,
      name: req.user.name,
    },
  });
});

/**
 * Example of protecting multiple routes
 */
router.use('/protected/*', verifyFirebaseToken);

router.get('/protected/user-data', (req, res) => {
  res.json({
    success: true,
    data: 'This is protected user data',
    userId: req.user.uid,
  });
});

router.post('/protected/update-profile', (req, res) => {
  const { name, preferences } = req.body;
  
  // Here you would typically update the user's profile in your database
  res.json({
    success: true,
    message: 'Profile updated successfully',
    updatedBy: req.user.uid,
    updates: { name, preferences },
  });
});

export default router;