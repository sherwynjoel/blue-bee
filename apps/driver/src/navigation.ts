import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/** The signed-in stack: shift home → route → one stop → POD capture, plus account settings. */
export type RootStackParamList = {
  Home: undefined;
  Route: undefined;
  Stop: { stopId: string };
  Pod: { stopId: string };
  Weigh: { stopId: string };
  Chat: { orderId: string };
  Settings: undefined;
};

export type HomeProps = NativeStackScreenProps<RootStackParamList, 'Home'>;
export type RouteProps = NativeStackScreenProps<RootStackParamList, 'Route'>;
export type StopProps = NativeStackScreenProps<RootStackParamList, 'Stop'>;
export type PodProps = NativeStackScreenProps<RootStackParamList, 'Pod'>;
export type WeighProps = NativeStackScreenProps<RootStackParamList, 'Weigh'>;
export type ChatProps = NativeStackScreenProps<RootStackParamList, 'Chat'>;
export type SettingsProps = NativeStackScreenProps<RootStackParamList, 'Settings'>;
