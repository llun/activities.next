const { getConfig } = require('./lib/config');

try {
  const config = getConfig();
  console.log('Config loaded successfully');
  console.log('Host:', config.host);
  console.log('Secret phase exists:', !!config.secretPhase);
  console.log('Auth config:', config.auth);
} catch (error) {
  console.error('Config error:', error.message);
  console.error('Stack:', error.stack);
}