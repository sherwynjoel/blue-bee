import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme, DarkTheme, type Theme as NavTheme } from '@react-navigation/native';
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
import { useTheme } from './src/theme';
import { Text } from './src/components/kit';
import { navigationRef, type RootStackParamList } from './src/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Brand the native-stack header + screen backgrounds with the Daylight palette (light/dark). */
function useNavTheme(): NavTheme {
  const t = useTheme();
  const base = t.isDark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: { ...base.colors, primary: t.color.azure, background: t.color.canvas, card: t.color.surface, text: t.color.text, border: t.color.hairline },
  };
}

/** The signed-in owner cockpit. Push deep-links are wired here, so they only fire while the stack is
 *  mounted (an owner is signed in) and route to an existing screen. */
function SignedInStack(): React.ReactElement {
  const t = useTheme();
  useNotificationDeepLinks();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: t.color.surface },
        headerTitleStyle: { color: t.color.text, fontWeight: '700' },
        headerTintColor: t.color.azure,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.color.canvas },
      }}
    >
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

/** A branded, dark-mode-aware loading splash. */
function Splash(): React.ReactElement {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, backgroundColor: t.color.canvas }}>
      <View style={{ width: 76, height: 76, borderRadius: 22, backgroundColor: t.color.azureTint, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="display" color={t.color.azure}>🐝</Text>
      </View>
      <ActivityIndicator size="large" color={t.color.azure} />
    </View>
  );
}

/** Auth + RBAC gate: loading splash → login (signed out) → no-access (non-owner) → the cockpit. */
function Root(): React.ReactElement {
  const { status, isOwner } = useSession();
  if (status === 'loading') return <Splash />;
  if (status === 'signedOut') return <LoginScreen />;
  if (!isOwner) return <NoAccessScreen />;
  return <SignedInStack />;
}

function Shell(): React.ReactElement {
  const navTheme = useNavTheme();
  const t = useTheme();
  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <Root />
      <StatusBar style={t.isDark ? 'light' : 'dark'} />
    </NavigationContainer>
  );
}

export default function App(): React.ReactElement {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
