function fn() {
  // For end-to-end testing, we use a simple mock token.
  // The webhook service is configured to accept 'mock-token' when NODE_ENV=test.
  return 'mock-token';
}
