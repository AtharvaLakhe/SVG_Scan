const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser',
  timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:8765', reducedMotion: 'reduce', headless: true },
  webServer: { command: 'node tests/server.js', url: 'http://127.0.0.1:8765', reuseExistingServer: true },
  reporter: 'list',
  workers: 1
});
