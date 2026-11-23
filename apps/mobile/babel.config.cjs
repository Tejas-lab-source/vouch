// @ts-check
/** Expo's Babel preset (JSX, React Native, Expo Router). */
module.exports = function config(/** @type {any} */ api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
