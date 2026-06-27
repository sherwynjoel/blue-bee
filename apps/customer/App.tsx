import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator } from 'react-native';
import { DefaultTheme, DarkTheme, NavigationContainer, type Theme as NavTheme } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StripeProvider } from '@stripe/stripe-react-native';
import { SessionProvider, useSession } from './src/session/SessionProvider';
import { LoginScreen } from './src/screens/LoginScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { BookScreen } from './src/screens/BookScreen';
import { OrderDetailScreen } from './src/screens/OrderDetailScreen';
import { TrackScreen } from './src/screens/TrackScreen';
import { PayScreen } from './src/screens/PayScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { navigationRef, openOrderTracking, type RootStackParamList } from './src/navigation';
import { usePushDeepLinks } from './src/push/register';
import { STRIPE_PUBLISHABLE_KEY } from './src/config';
import { ThemeProvider, useTheme, type Theme } from './theme';
import { BeeMark, Text } from './components/ui';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** React Navigation theme derived from Daylight (header/card/background/tint all match the app theme). */
function buildNavTheme(theme: Theme): NavTheme {
  const base = theme.isDark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: theme.isDark,
    colors: {
      ...base.colors,
      primary: theme.colors.azure,
      background: theme.colors.canvas,
      card: theme.colors.canvas,
      text: theme.colors.text,
      border: theme.colors.hairline,
      notification: theme.colors.danger,
    },
  };
}

/** Shared header chrome — clean canvas header, large titles (iOS), azure tint, no hairline shadow. */
function screenOptions(theme: Theme): NativeStackNavigationOptions {
  return {
    headerLargeTitle: true,
    headerShadowVisible: false,
    headerTintColor: theme.colors.azure,
    headerStyle: { backgroundColor: theme.colors.canvas },
    headerLargeTitleStyle: { color: theme.colors.text, fontWeight: '700' },
    headerTitleStyle: { color: theme.colors.text, fontWeight: '600' },
    headerBackTitleVisible: false,
    contentStyle: { backgroundColor: theme.colors.canvas },
  };
}

/** Auth gate: branded splash → login (signed out) → the themed customer stack (signed in). */
function Root(): React.ReactElement {
  const theme = useTheme();
  const { status } = useSession();

  // A tapped geofence push deep-links to that order's tracking (scoped to the customer's own order).
  usePushDeepLinks(useCallback((orderId: string) => openOrderTracking(orderId), []));

  if (status === 'loading') {
    return (
      <View style={[styles.splash, { backgroundColor: theme.colors.canvas }]}>
        <BeeMark size={84} />
        <Text variant="title2" weight="700" style={{ marginTop: 20 }}>
          Blue Bee
        </Text>
        <ActivityIndicator style={{ marginTop: 16 }} color={theme.colors.azure} />
      </View>
    );
  }

  if (status === 'signedOut') return <LoginScreen />;

  return (
    <Stack.Navigator screenOptions={screenOptions(theme)}>
      <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: 'My orders' }} />
      <Stack.Screen name="Book" component={BookScreen} options={{ title: 'Book a cleaning' }} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Order', headerLargeTitle: false }} />
      <Stack.Screen name="Track" component={TrackScreen} options={{ title: 'Track my truck', headerLargeTitle: false }} />
      <Stack.Screen name="Pay" component={PayScreen} options={{ title: 'Pay', headerLargeTitle: false }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Stack.Navigator>
  );
}

/** Wires the resolved Daylight theme into the navigation container + status bar. */
function Shell(): React.ReactElement {
  const theme = useTheme();
  const navTheme = useMemo(() => buildNavTheme(theme), [theme]);
  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <Root />
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
    </NavigationContainer>
  );
}

export default function App(): React.ReactElement {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        {/* PaymentSheet (Increment 12): the publishable (non-secret) test key; the card never touches our API. */}
        <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
          <SessionProvider>
            <Shell />
          </SessionProvider>
        </StripeProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
