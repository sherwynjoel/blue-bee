import React, { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StripeProvider } from '@stripe/stripe-react-native';
import { SessionProvider, useSession } from './src/session/SessionProvider';
import { LoginScreen } from './src/screens/LoginScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { BookScreen } from './src/screens/BookScreen';
import { OrderDetailScreen } from './src/screens/OrderDetailScreen';
import { TrackScreen } from './src/screens/TrackScreen';
import { PayScreen } from './src/screens/PayScreen';
import { navigationRef, openOrderTracking, type RootStackParamList } from './src/navigation';
import { usePushDeepLinks } from './src/push/register';
import { STRIPE_PUBLISHABLE_KEY } from './src/config';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Auth gate: loading splash → login (signed out) → the customer stack (signed in). */
function Root(): React.ReactElement {
  const { status } = useSession();

  // A tapped geofence push deep-links to that order's tracking (scoped to the customer's own order).
  usePushDeepLinks(useCallback((orderId: string) => openOrderTracking(orderId), []));

  if (status === 'loading') {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#1f6feb" />
      </View>
    );
  }

  if (status === 'signedOut') return <LoginScreen />;

  return (
    <Stack.Navigator>
      <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: 'My orders' }} />
      <Stack.Screen name="Book" component={BookScreen} options={{ title: 'Book a cleaning' }} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Order' }} />
      <Stack.Screen name="Track" component={TrackScreen} options={{ title: 'Track my truck' }} />
      <Stack.Screen name="Pay" component={PayScreen} options={{ title: 'Pay' }} />
    </Stack.Navigator>
  );
}

export default function App(): React.ReactElement {
  return (
    <SafeAreaProvider>
      {/* PaymentSheet (Increment 12): the publishable (non-secret) test key; the card never touches our API. */}
      <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
        <SessionProvider>
          <NavigationContainer ref={navigationRef}>
            <Root />
            <StatusBar style="auto" />
          </NavigationContainer>
        </SessionProvider>
      </StripeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
});
