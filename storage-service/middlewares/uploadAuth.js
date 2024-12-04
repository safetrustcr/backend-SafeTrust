const uploadAuth = (req, res, next) => {
    try {
      req.s3_key_prefix = req.headers['x-path'].replace(/^\/+/g, '');
      req.saved_files = [];
      next();
    } catch (e) {
      return next(new Error('x-path header incorrect'));
    }
  };
  
  module.exports = uploadAuth;
  