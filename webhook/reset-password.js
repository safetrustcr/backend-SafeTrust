const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// Initialize PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgrespassword@postgres:5432/postgres'
});

// Validate reset token
router.get('/validate-reset-token', async (req, res) => {
  console.log('Received validate token request');
  console.log('Request query:', req.query);
  console.log('Request headers:', req.headers);
  
  try {
    const { token } = req.query;

    if (!token) {
      console.log('No token provided in request');
      return res.status(400).json({ error: 'Token is required' });
    }

    console.log('Checking token in database...');
    // Check if token exists, is not used, and is not expired
    const result = await pool.query(
      `SELECT id 
       FROM password_reset_tokens 
       WHERE token = $1 
       AND used = FALSE
       AND expires_at > NOW()`,
      [token]
    );

    console.log('Database query result:', result.rows);

    if (result.rowCount === 0) {
      console.log('No valid token found');
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    console.log('Token validated successfully');
    res.json({ valid: true });
  } catch (error) {
    console.error('Validate token error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    // Start a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Find valid reset token and get user ID
      const tokenResult = await client.query(
        `SELECT id, user_id 
         FROM password_reset_tokens 
         WHERE token = $1 
         AND used = FALSE
         AND expires_at > NOW()`,
        [token]
      );

      if (tokenResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid or expired reset token' });
      }

      const { id: tokenId, user_id: userId } = tokenResult.rows[0];

      // Hash the new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update user's password
      await client.query(
        'UPDATE users SET password = $1 WHERE id = $2',
        [hashedPassword, userId]
      );

      // Mark token as used
      await client.query(
        'UPDATE password_reset_tokens SET used = TRUE WHERE id = $1',
        [tokenId]
      );

      await client.query('COMMIT');
      res.json({ message: 'Password has been reset successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 