import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/** The signed-in stack: shift home → route → one stop. */
export type RootStackParamList = {
  Home: undefined;
  Route: undefined;
  Stop: { stopId: string };
};

export type HomeProps = NativeStackScreenProps<RootStackParamList, 'Home'>;
export type RouteProps = NativeStackScreenProps<RootStackParamList, 'Route'>;
export type StopProps = NativeStackScreenProps<RootStackParamList, 'Stop'>;
