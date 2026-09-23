import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Whether a Google Maps Android API key is configured for this build.
 *
 * On Android `react-native-maps` always renders through Google Maps (there is no alternative
 * provider, so `PROVIDER_DEFAULT` is Google too). Mounting a `MapView` with no
 * `com.google.android.geo.API_KEY` in the manifest does NOT degrade to a blank map — it throws
 * "API key not found", which takes down the whole screen. For the driver that is the route screen,
 * i.e. the app's core workflow, mid-shift.
 *
 * The key comes from `app.json` → `expo.android.config.googleMaps.apiKey`, which Expo copies into
 * the manifest at prebuild. When it is absent we skip the map and show an honest placeholder rather
 * than crash. iOS renders Apple Maps without a key, so this only gates Android.
 */
export function googleMapsAvailable(): boolean {
  if (Platform.OS !== 'android') return true;
  const key = Constants.expoConfig?.android?.config?.googleMaps?.apiKey;
  return typeof key === 'string' && key.length > 0;
}
