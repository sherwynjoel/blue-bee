import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from './src/session/SessionProvider';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { RouteScreen } from './src/screens/RouteScreen';
import { StopScreen } from './src/screens/StopScreen';
import type { RootStackParamList } from './src/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Auth gate: loading splash → login (signed out) → the duty-loop stack (signed in). */
function Root(): React.ReactElement {
  const { status } = useSession();

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
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'My shift' }} />
      <Stack.Screen name="Route" component={RouteScreen} options={{ title: 'My route today' }} />
      <Stack.Screen name="Stop" component={StopScreen} options={{ title: 'Stop' }} />
    </Stack.Navigator>
  );
}

export default function App(): React.ReactElement {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <NavigationContainer>
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
