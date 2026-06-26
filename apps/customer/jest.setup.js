/* eslint-disable */
// Test setup: mock the native Expo/RN modules the customer app touches so component/unit tests run
// under Node. These mocks stand in for the NATIVE bridge ONLY in tests — the shipped app uses the
// real modules (real expo-secure-store / expo-notifications / expo-image-picker / expo-file-system /
// react-native-maps / socket.io-client).

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
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[customer-test-token]' })),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  AndroidImportance: { MAX: 5, DEFAULT: 3 },
}));

jest.mock('expo-device', () => ({ isDevice: true, modelName: 'Test Device' }));

jest.mock('expo-constants', () => ({ expoConfig: { extra: { apiBaseUrl: 'http://localhost:3000' } } }));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('expo-file-system', () => ({
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1234, uri: 'file:///tmp/x.jpg' })),
  uploadAsync: jest.fn(async () => ({ status: 200, body: '' })),
  FileSystemUploadType: { BINARY_CONTENT: 1 },
}));

// @stripe/stripe-react-native (Increment 12): the native PaymentSheet bridge isn't available under
// Node. Default mock = a successful sheet; component tests override useStripe to drive failure/cancel.
jest.mock('@stripe/stripe-react-native', () => {
  const React = require('react');
  return {
    __esModule: true,
    StripeProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    useStripe: () => ({
      initPaymentSheet: jest.fn(async () => ({})),
      presentPaymentSheet: jest.fn(async () => ({})),
    }),
  };
});

// react-native-maps: lightweight stand-ins so screens that render a map still mount in tests.
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Mock = (name) => {
    const C = (props) => React.createElement(View, { ...props, testID: props.testID ?? name }, props.children);
    C.displayName = name;
    return C;
  };
  const MapView = Mock('MapView');
  return {
    __esModule: true,
    default: MapView,
    Marker: Mock('Marker'),
    PROVIDER_GOOGLE: 'google',
    PROVIDER_DEFAULT: undefined,
  };
});
