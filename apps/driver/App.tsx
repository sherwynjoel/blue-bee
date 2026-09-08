import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme, DarkTheme, type Theme as NavTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from './src/session/SessionProvider';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { RouteScreen } from './src/screens/RouteScreen';
import { StopScreen } from './src/screens/StopScreen';
import { PodScreen } from './src/screens/PodScreen';
import { WeighScreen } from './src/screens/WeighScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { Text, useTheme } from '@blue-bee/ui';
import type { RootStackParamList } from './src/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Brand a native-stack header + screen backgrounds with the Daylight palette (light/dark). */
function useNavTheme(): NavTheme {
  const t = useTheme();
  const base = t.isDark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: t.colors.azure,
      background: t.colors.canvas,
      card: t.colors.surface,
      text: t.colors.text,
      border: t.colors.hairline,
    },
  };
}

/** A branded, dark-mode-aware loading splash (replaces the bare spinner). */
function Splash(): React.ReactElement {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, backgroundColor: t.colors.canvas }}>
      <View style={{ width: 76, height: 76, borderRadius: 22, backgroundColor: t.colors.azureTint, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="display" color={t.colors.azure}>🐝</Text>
      </View>
      <ActivityIndicator size="large" color={t.colors.azure} />
    </View>
  );
}

/** Auth gate: loading splash → login (signed out) → the duty-loop stack (signed in). */
function Root(): React.ReactElement {
  const { status } = useSession();
  const t = useTheme();

  if (status === 'loading') return <Splash />;
  if (status === 'signedOut') return <LoginScreen />;

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: t.colors.surface },
        headerTitleStyle: { color: t.colors.text, fontWeight: '700' },
        headerTintColor: t.colors.azure,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.colors.canvas },
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'My shift' }} />
      <Stack.Screen name="Route" component={RouteScreen} options={{ title: 'My route today' }} />
      <Stack.Screen name="Stop" component={StopScreen} options={{ title: 'Stop' }} />
      <Stack.Screen name="Pod" component={PodScreen} options={{ title: 'Proof of delivery' }} />
      <Stack.Screen name="Weigh" component={WeighScreen} options={{ title: 'Weigh load' }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={{ title: 'Messages' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Stack.Navigator>
  );
}

function Shell(): React.ReactElement {
  const navTheme = useNavTheme();
  const t = useTheme();
  return (
    <NavigationContainer theme={navTheme}>
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
