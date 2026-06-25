// Metro config for the Blue Bee monorepo: watch the workspace root so `@blue-bee/shared` +
// `@blue-bee/api-client` (built to their dist/) resolve, and look up node_modules at both the app
// and root. (Mirrors apps/driver/metro.config.js.)
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
