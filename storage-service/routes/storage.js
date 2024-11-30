const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const s3 = require('../utils/s3Client');
const uploadAuth = require('../middlewares/uploadAuth');
const { R2_BUCKET } = require('../config/config');

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: R2_BUCKET,
    metadata: (req, file, cb) => {
      cb(null, { originalname: file.originalname });
    },
    key: (req, file, cb) => {
      const uuid = uuidv4();
      const key = `${req.s3_key_prefix}${uuid}`;
      req.saved_files.push({
        originalname: file.originalname,
        mimetype: file.mimetype,
        key: key
      });
      cb(null, key);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only images and PDFs are allowed.'));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 } // Límite de 10 MB por archivo
});

router.use((err, req, res, next) => {
  if (err) {
    if (err.message.includes('file size')) {
      return res.status(400).json({ error: 'File size exceeds 10MB limit.' });
    } else if (err.message.includes('Invalid file type')) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: 'An unexpected error occurred.' });
  }
});

router.post('/upload', uploadAuth, upload.array('files', 50), (req, res) => {
  res.json(req.saved_files);
});

module.exports = router;
