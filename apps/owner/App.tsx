import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from './src/session/SessionProvider';
import { LoginScreen } from './src/screens/LoginScreen';
import { NoAccessScreen } from './src/screens/NoAccessScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { FleetScreen } from './src/screens/FleetScreen';
import { ApprovalsScreen } from './src/screens/ApprovalsScreen';
import { ExceptionsScreen } from './src/screens/ExceptionsScreen';
import { OrderDetailScreen } from './src/screens/OrderDetailScreen';
import { RouteDetailScreen } from './src/screens/RouteDetailScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { useNotificationDeepLinks } from './src/push/useDeepLink';
import { navigationRef, type RootStackParamList } from './src/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** The signed-in owner cockpit. Push deep-links are wired here, so they only fire while the stack is
 *  mounted (an owner is signed in) and route to an existing screen. */
function SignedInStack(): React.ReactElement {
  useNotificationDeepLinks();
  return (
    <Stack.Navigator>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Today' }} />
      <Stack.Screen name="Fleet" component={FleetScreen} options={{ title: 'Live fleet' }} />
      <Stack.Screen name="Approvals" component={ApprovalsScreen} options={{ title: 'Approvals' }} />
      <Stack.Screen name="Exceptions" component={ExceptionsScreen} options={{ title: 'Exceptions' }} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Order' }} />
      <Stack.Screen
        name="RouteDetail"
        component={RouteDetailScreen}
        options={({ route }) => ({ title: route.params.title ?? 'Route' })}
      />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Stack.Navigator>
  );
}

/** Auth + RBAC gate: loading splash → login (signed out) → no-access (non-owner) → the cockpit. */
function Root(): React.ReactElement {
  const { status, isOwner } = useSession();

  if (status === 'loading') {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#1f6feb" />
      </View>
    );
  }
  if (status === 'signedOut') return <LoginScreen />;
  if (!isOwner) return <NoAccessScreen />;
  return <SignedInStack />;
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
