/* eslint-disable */
// Test setup: mock the native Expo modules the app touches so component/unit tests run under Node.
// These mocks stand in for the NATIVE bridge ONLY in tests — the shipped app uses the real modules.

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k) => void store.delete(k)),
    __store: store,
  };
});

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4, BestForNavigation: 6 },
  ActivityType: { AutomotiveNavigation: 3 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 43.7615, longitude: -79.4111 } })),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
}));

// ── Increment-17 POD-capture native modules (the device camera / file IO / signature pad run real
// on-device; these mocks stand in for the native bridge ONLY in tests). ──
jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  launchCameraAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///pod-photo.jpg', mimeType: 'image/jpeg', fileSize: 2048 }] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///lib.jpg', mimeType: 'image/jpeg', fileSize: 2048 }] })),
}));

jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///cache/',
  FileSystemUploadType: { BINARY_CONTENT: 'BINARY_CONTENT' },
  EncodingType: { Base64: 'base64' },
  uploadAsync: jest.fn(async () => ({ status: 200, body: '' })),
  writeAsStringAsync: jest.fn(async () => undefined),
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1500 })),
}));

// react-native-signature-canvas wraps a webview canvas; mock it as a ref-bearing no-op whose
// readSignature() yields a fake base64 PNG (the real pad produces a real PNG on device).
jest.mock('react-native-signature-canvas', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Sig = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      readSignature: () => props.onOK && props.onOK('data:image/png;base64,iVBORw0KGgoAAAANSU'),
      clearSignature: () => undefined,
    }));
    return React.createElement(View, { testID: 'mock-signature-canvas' });
  });
  return { __esModule: true, default: Sig };
});

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
  unregisterTaskAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test-token-xyz]' })),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  AndroidImportance: { MAX: 5, DEFAULT: 3 },
}));

// @expo/vector-icons pulls expo-font's native font loader, which doesn't import cleanly under Node.
// Mock the whole family to lightweight no-op components (the real icons ship in the device bundle).
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const Icon = (props) => React.createElement(Text, { testID: props.testID });
  return new Proxy(
    {},
    {
      get: (_target, prop) => (prop === '__esModule' ? true : Icon),
    },
  );
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('expo-device', () => ({ isDevice: true, modelName: 'Test Device' }));

jest.mock('expo-constants', () => ({ expoConfig: { extra: { apiBaseUrl: 'http://localhost:3000' } } }));
