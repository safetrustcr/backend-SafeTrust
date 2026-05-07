const axios = require('axios');

const TRUSTLESSWORK_BASE_URL = process.env.TRUSTLESSWORK_API_URL || 'https://api.trustlesswork.com';
const TRUSTLESSWORK_API_KEY = process.env.TRUSTLESSWORK_API_KEY;

const trustlessWork = axios.create({
  baseURL: TRUSTLESSWORK_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    ...(TRUSTLESSWORK_API_KEY ? { 'X-API-Key': TRUSTLESSWORK_API_KEY } : {}),
  },
});

trustlessWork.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const data = error.response?.data;
    console.error('[trustlesswork] API error:', { status, data });
    return Promise.reject(error);
  }
);

module.exports = { trustlessWork };
