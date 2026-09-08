import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Feather } from '@expo/vector-icons';
import { DefaultTheme, DarkTheme, NavigationContainer, useNavigation, type NavigationProp, type Theme as NavTheme } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StripeProvider } from '@stripe/stripe-react-native';
import { SessionProvider, useSession } from './src/session/SessionProvider';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { BookScreen } from './src/screens/BookScreen';
import { OrderDetailScreen } from './src/screens/OrderDetailScreen';
import { TrackScreen } from './src/screens/TrackScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { PayScreen } from './src/screens/PayScreen';
import { RateScreen } from './src/screens/RateScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ReferScreen } from './src/screens/ReferScreen';
import { AddressesScreen } from './src/screens/AddressesScreen';
import { AddressFormScreen } from './src/screens/AddressFormScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { PricingScreen } from './src/screens/PricingScreen';
import { navigationRef, openOrderTracking, type BookParams, type RootStackParamList } from './src/navigation';
import { usePushDeepLinks } from './src/push/register';
import { STRIPE_PUBLISHABLE_KEY } from './src/config';
import { useTheme, type Theme } from './theme';
import { Text, fireHaptic } from './components/ui';

/** Per-device flag: the first-run onboarding carousel is shown once, then never again. */
const ONBOARDED_KEY = 'royal.onboarded';

/**
 * [Inc-33] The bottom-tab param list — the customer nav shell is now **Service · Orders · Profile** (the
 * Refer tab lands in Inc-34). The tab route NAMES are deliberately UNCHANGED from the previous shell
 * (`Home` · `Orders` · `Settings`) so the frozen screens' `navigate('Settings' | 'Book' | 'OrderDetail')`
 * calls resolve exactly as before — 'Settings' is the sibling tab (now rendered as **Profile**), 'Book' /
 * 'OrderDetail' bubble up to the root stack. Only the tab BAR (labels/icons) and the Book affordance
 * change: Book is no longer a center FAB — it is the Service tab's primary action (HomeScreen header),
 * which still pushes 'Book' onto the root stack. Keeping the route names stable is what preserves the
 * frozen `RootStackParamList` param shapes.
 *
 * [Inc-34] A 4th tab, **Refer**, is added (route name 'Refer' — net-new, nothing frozen navigates to it).
 */
type TabParamList = { Home: undefined; Services: undefined; Orders: undefined; Settings: undefined; Refer: undefined; Pricing: undefined };
type RootNavParamList = {
  Main: undefined;
  // [Inc-26] Book now takes params (a preselected site after adding an address). This list is the
  // NAVIGATOR's generic; `RootStackParamList` in src/navigation.ts is what screens import. Both must
  // agree — a route typed in only one compiles but fails to navigate or fails to type.
  Book: BookParams | undefined;
  OrderDetail: { orderId: string };
  Track: { orderId: string };
  Chat: { orderId: string };
  Pay: { orderId: string };
  Rate: { orderId: string };
  Addresses: undefined;
  AddressForm: { siteId?: string; returnTo?: 'Book' } | undefined;
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

/** [Royal] The bottom dock — Home · Pricing · (Order + FAB) · Invite · Profile, per the reference. The
 *  center FAB starts a new order (→ the Services picker). Route NAMES stay stable so frozen navigate()
 *  calls resolve: 'Settings' is the Profile tab, 'Refer' is Invite; Services/Orders remain registered tab
 *  routes (reached via the FAB and Home's "see all"), just without their own dock button. */
function DaylightTabBar({ state, navigation }: BottomTabBarProps): React.ReactElement {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const active = state.routeNames[state.index];

  const go = (name: keyof TabParamList): void => {
    fireHaptic('selection');
    navigation.navigate(name);
  };

  return (
    <View style={[styles.tabBar, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      <TabButton icon="home" label="Home" active={active === 'Home'} onPress={() => go('Home')} />
      <TabButton icon="dollar-sign" label="Pricing" active={active === 'Pricing'} onPress={() => go('Pricing')} />
      <OrderFab onPress={() => go('Services')} />
      <TabButton icon="gift" label="Invite" active={active === 'Refer'} onPress={() => go('Refer')} />
      <TabButton icon="user" label="Profile" active={active === 'Settings'} onPress={() => go('Settings')} />
    </View>
  );
}

/** The center "+" Order action — an elevated royal-blue disc that rises above the dock. Not a tab route;
 *  it starts a new order by jumping to the Services picker. */
function OrderFab({ onPress }: { onPress: () => void }): React.ReactElement {
  const { colors, elevation } = useTheme();
  return (
    <View style={styles.tabItem}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="New order" style={[styles.fab, { backgroundColor: colors.azure }, elevation.e2]}>
        <Feather name="plus" size={26} color={colors.onAzure} />
      </Pressable>
      <Text variant="caption" weight="600" style={{ color: colors.azure, marginTop: 4 }}>
        Order
      </Text>
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

/** [Inc-33] The signed-in home surface: a three-tab bottom bar — Service · Orders · Profile. */
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
      {/* [Inc-37] Home — the landing dashboard (what's new · my orders · my account + credit). Owns its own header. */}
      <Tab.Screen name="Home" component={DashboardScreen} options={{ headerShown: false }} />
      {/* Services (catalogue grid). HomeScreen owns its own header, so the tab header is hidden. */}
      <Tab.Screen name="Services" component={HomeScreen} options={{ headerShown: false }} />
      <Tab.Screen name="Orders" component={OrdersTab} options={{ title: 'My orders' }} />
      {/* Profile tab — route name stays 'Settings' (frozen), titled/labelled "Profile". */}
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'Profile' }} />
      {/* [Inc-34] Refer tab — invite friends (reward deferred; no reward copy). Labelled "Invite" in the dock. */}
      <Tab.Screen name="Refer" component={ReferScreen} options={{ title: 'Refer' }} />
      {/* [Royal] Pricing is now a first-class dock tab (was a pushed route). Owns its own header. */}
      <Tab.Screen name="Pricing" component={PricingScreen} options={{ headerShown: false }} />
    </Tab.Navigator>
  );
}

/** Auth gate: branded splash → login (signed out) → the themed customer stack (signed in). */
function Root(): React.ReactElement {
  const theme = useTheme();
  const { status } = useSession();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  // A tapped geofence push deep-links to that order's tracking (scoped to the customer's own order).
  usePushDeepLinks(useCallback((orderId: string) => openOrderTracking(orderId), []));

  // First-run gate: read the per-device "seen onboarding" flag once. Fail open so a read error never
  // traps a returning customer in the intro.
  useEffect(() => {
    let alive = true;
    SecureStore.getItemAsync(ONBOARDED_KEY)
      .then((v) => alive && setOnboarded(v === '1'))
      .catch(() => alive && setOnboarded(true));
    return () => {
      alive = false;
    };
  }, []);
  const completeOnboarding = useCallback(() => {
    setOnboarded(true);
    void SecureStore.setItemAsync(ONBOARDED_KEY, '1').catch(() => undefined);
  }, []);

  if (status === 'loading' || onboarded === null) {
    return (
      <View style={[styles.splash, { backgroundColor: theme.colors.surface }]}>
        {/* The Royal crest (crown + basket wordmark) — the brand moment on the loading splash. */}
        <Image source={require('./assets/brand/royal-logo.png')} style={styles.splashLogo} resizeMode="contain" accessibilityLabel="Royal Dry Cleaning & Laundry" />
        <ActivityIndicator style={{ marginTop: 8 }} color={theme.colors.azure} />
      </View>
    );
  }

  if (status === 'signedOut') return onboarded ? <LoginScreen /> : <OnboardingScreen onDone={completeOnboarding} />;

  return (
    <RootStack.Navigator screenOptions={screenOptions(theme)}>
      <RootStack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <RootStack.Screen name="Book" component={BookScreen} options={{ title: 'Book a cleaning' }} />
      <RootStack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Order', headerLargeTitle: false }} />
      <RootStack.Screen name="Track" component={TrackScreen} options={{ title: 'Track my truck', headerLargeTitle: false }} />
      <RootStack.Screen name="Chat" component={ChatScreen} options={{ title: 'Messages', headerLargeTitle: false }} />
      <RootStack.Screen name="Pay" component={PayScreen} options={{ title: 'Pay', headerLargeTitle: false }} />
      <RootStack.Screen name="Rate" component={RateScreen} options={{ title: 'Rate your order', headerLargeTitle: false }} />
      <RootStack.Screen name="Addresses" component={AddressesScreen} options={{ title: 'Saved addresses', headerLargeTitle: false }} />
      {/* Title is set by the screen itself ("Add address" vs "Edit address"). */}
      <RootStack.Screen name="AddressForm" component={AddressFormScreen} options={{ title: 'Address', headerLargeTitle: false }} />
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
      {/* PaymentSheet (Increment 12): the publishable (non-secret) test key; the card never touches our API. */}
      <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
        <SessionProvider>
          <Shell />
        </SessionProvider>
      </StripeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  splashLogo: { width: 220, height: 220 },
  // Floating card-like dock: rounded top corners + a soft upward shadow, no flush hairline (matches the reference).
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    paddingHorizontal: 8,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#0A2540',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 12,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fab: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', marginTop: -20 },
});
