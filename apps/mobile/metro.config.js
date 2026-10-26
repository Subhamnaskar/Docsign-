// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// pdf-lib uses tslib 1.x, whose "import" entry wraps a UMD file that Metro can't
// read a default export from; the plain ES module build works everywhere.
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = resolveRequest ?? context.resolveRequest;
  if (moduleName === 'tslib') return resolve(context, 'tslib/tslib.es6.js', platform);
  return resolve(context, moduleName, platform);
};

module.exports = config;
