import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { DefaultTheme, DarkTheme, NavigationContainer, useNavigation, type NavigationProp, type Theme as NavTheme } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StripeProvider } from '@stripe/stripe-react-native';
import { SessionProvider, useSession } from './src/session/SessionProvider';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { BookScreen } from './src/screens/BookScreen';
import { OrderDetailScreen } from './src/screens/OrderDetailScreen';
import { TrackScreen } from './src/screens/TrackScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { PayScreen } from './src/screens/PayScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { navigationRef, openOrderTracking, type RootStackParamList } from './src/navigation';
import { usePushDeepLinks } from './src/push/register';
import { STRIPE_PUBLISHABLE_KEY } from './src/config';
import { ThemeProvider, useTheme, type Theme } from './theme';
import { BeeMark, Text, fireHaptic } from './components/ui';

/**
 * The bottom-tab param list (Home · Orders · More→Settings) nested inside the root stack. The tab route
 * NAMES intentionally reuse `RootStackParamList` names ('Orders'/'Settings') so the frozen screens'
 * `navigate('Settings' | 'Book' | 'OrderDetail')` calls resolve unchanged — a tab sibling for 'Settings',
 * a bubble-up to the root stack for 'Book'/'OrderDetail'. Book is NOT a tab (it uses `.replace` on the
 * stack) — the center FAB pushes it onto the root stack instead.
 */
type TabParamList = { Home: undefined; Orders: undefined; Settings: undefined };
type RootNavParamList = {
  Main: undefined;
  Book: undefined;
  OrderDetail: { orderId: string };
  Track: { orderId: string };
  Chat: { orderId: string };
  Pay: { orderId: string };
};

const Tab = createBottomTabNavigator<TabParamList>();
const RootStack = createNativeStackNavigator<RootNavParamList>();

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

// ───────────────────────────── bottom tabs ─────────────────────────────

/**
 * Wraps the (frozen) OrdersScreen so it still receives a `NavigationProp<RootStackParamList>` from
 * `useNavigation` — no screen edit. At runtime this is the tab navigator's navigation, so
 * `navigate('OrderDetail'|'Book')` bubbles to the root stack and `navigate('Settings')` hits the sibling tab.
 */
function OrdersTab(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  return <OrdersScreen navigation={navigation} />;
}

/** The Daylight bottom tab bar — Home · Orders · center Book FAB · More. Real features only (no Prepaid). */
function DaylightTabBar({ state, navigation }: BottomTabBarProps): React.ReactElement {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const active = state.routeNames[state.index];

  const go = (name: keyof TabParamList): void => {
    fireHaptic('selection');
    navigation.navigate(name);
  };
  const book = (): void => {
    fireHaptic('selection');
    // Book lives on the ROOT stack (it uses `.replace`) — push it over the tabs.
    navigation.getParent()?.navigate('Book');
  };

  return (
    <View style={[styles.tabBar, { backgroundColor: colors.surface, borderTopColor: colors.hairline, paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      <TabButton icon="home" label="Home" active={active === 'Home'} onPress={() => go('Home')} />
      <TabButton icon="package" label="Orders" active={active === 'Orders'} onPress={() => go('Orders')} />
      <BookFab onPress={book} />
      <TabButton icon="menu" label="More" active={active === 'Settings'} onPress={() => go('Settings')} />
    </View>
  );
}

function TabButton({ icon, label, active, onPress }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; active: boolean; onPress: () => void }): React.ReactElement {
  const { colors } = useTheme();
  const tint = active ? colors.azure : colors.textTertiary;
  return (
    <Pressable style={styles.tabItem} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={label} hitSlop={6}>
      <Feather name={icon} size={22} color={tint} />
      <Text variant="caption" weight={active ? '700' : '500'} style={{ color: tint, marginTop: 3 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function BookFab({ onPress }: { onPress: () => void }): React.ReactElement {
  const { colors, elevation } = useTheme();
  return (
    <Pressable style={styles.tabItem} onPress={onPress} accessibilityRole="button" accessibilityLabel="Book now" hitSlop={6}>
      <View style={[styles.fab, elevation.e2, { backgroundColor: colors.honey }]}>
        <Feather name="plus" size={26} color={colors.onHoney} />
      </View>
      <Text variant="caption" weight="700" style={{ color: colors.textSecondary, marginTop: 3 }}>
        Book
      </Text>
    </Pressable>
  );
}

/** The signed-in home surface: a bottom tab bar (Home · Orders · Book FAB · More). */
function MainTabs(): React.ReactElement {
  const theme = useTheme();
  return (
    <Tab.Navigator
      tabBar={(props) => <DaylightTabBar {...props} />}
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.canvas },
        headerTitleStyle: { color: theme.colors.text, fontWeight: '700' },
        headerTintColor: theme.colors.azure,
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <Tab.Screen name="Orders" component={OrdersTab} options={{ title: 'My orders' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
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
    <RootStack.Navigator screenOptions={screenOptions(theme)}>
      <RootStack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <RootStack.Screen name="Book" component={BookScreen} options={{ title: 'Book a cleaning' }} />
      <RootStack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Order', headerLargeTitle: false }} />
      <RootStack.Screen name="Track" component={TrackScreen} options={{ title: 'Track my truck', headerLargeTitle: false }} />
      <RootStack.Screen name="Chat" component={ChatScreen} options={{ title: 'Messages', headerLargeTitle: false }} />
      <RootStack.Screen name="Pay" component={PayScreen} options={{ title: 'Pay', headerLargeTitle: false }} />
    </RootStack.Navigator>
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
  tabBar: { flexDirection: 'row', alignItems: 'flex-start', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, paddingHorizontal: 8 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'flex-start' },
  fab: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginTop: -18 },
});
