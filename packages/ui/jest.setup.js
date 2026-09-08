/* eslint-disable */
// Test setup: mock the two native Expo modules this package touches so component/unit tests run
// under Node (jest-expo). The shipped apps use the real modules — these stand in for the native
// bridge ONLY in tests. Mirrors the relevant slice of apps/driver/jest.setup.js.

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
