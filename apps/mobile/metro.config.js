// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// pdf-lib uses tslib 1.x, whose "import" entry wraps a UMD file that Metro can't
// read a default export from; the plain ES module build works everywhere.
const tslibEs = path.join(__dirname, 'node_modules', 'tslib', 'tslib.es6.js');
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'tslib') return { type: 'sourceFile', filePath: tslibEs };
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
