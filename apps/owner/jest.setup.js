/* eslint-disable */
// Test setup: mock the native Expo modules the owner app touches so component/unit tests run under
// Node. These mocks stand in for the NATIVE bridge ONLY in tests — the shipped app uses the real
// modules. (The owner app is foreground-only: no expo-location / background task to mock.)

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k) => void store.delete(k)),
    __store: store,
  };
});

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test-token-xyz]' })),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
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
