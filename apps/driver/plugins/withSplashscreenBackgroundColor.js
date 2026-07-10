// Deterministically define the `splashscreen_background` Android color resource.
// The SDK 51 prebuild lays down drawable/splashscreen.xml referencing
// @color/splashscreen_background but does not always write the color into
// values/colors.xml, which breaks Android resource linking at build time.
// This plugin guarantees the color exists.
const { withAndroidColors } = require('@expo/config-plugins');

const SPLASH_BACKGROUND = '#ffffff';

module.exports = function withSplashscreenBackgroundColor(config) {
  return withAndroidColors(config, (cfg) => {
    const resources = cfg.modResults.resources;
    if (!resources.color) {
      resources.color = [];
    }
    const existing = resources.color.find(
      (c) => c.$ && c.$.name === 'splashscreen_background'
    );
    if (existing) {
      existing._ = SPLASH_BACKGROUND;
    } else {
      resources.color.push({
        $: { name: 'splashscreen_background' },
        _: SPLASH_BACKGROUND,
      });
    }
    return cfg;
  });
};
