// Required so jest-expo (babel-jest) can transform this package's .tsx and the untranspiled
// React Native / Expo sources it renders under test. Mirrors every app's babel.config.js.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
