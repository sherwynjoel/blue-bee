import React, { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from './src/session/SessionProvider';
import { LoginScreen } from './src/screens/LoginScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { BookScreen } from './src/screens/BookScreen';
import { OrderDetailScreen } from './src/screens/OrderDetailScreen';
import { TrackScreen } from './src/screens/TrackScreen';
import { navigationRef, openOrderTracking, type RootStackParamList } from './src/navigation';
import { usePushDeepLinks } from './src/push/register';

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
    </Stack.Navigator>
  );
}

export default function App(): React.ReactElement {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <NavigationContainer ref={navigationRef}>
          <Root />
          <StatusBar style="auto" />
        </NavigationContainer>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
});
