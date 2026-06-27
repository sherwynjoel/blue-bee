/**
 * A dark map style for `react-native-maps` (applied via `customMapStyle` on the Google provider /
 * Android; Apple Maps on iOS honors `userInterfaceStyle="dark"` instead, ignoring this). Tuned toward
 * the Daylight dark canvas so the azure vehicle marker reads cleanly. Presentation only.
 */
export const DARK_MAP_STYLE: Array<{ featureType?: string; elementType?: string; stylers: Array<Record<string, string>> }> = [
  { elementType: 'geometry', stylers: [{ color: '#0A0E1A' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0A0E1A' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6B7C96' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#5A6B82' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#5A6B82' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#111728' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#141B2D' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0A0E1A' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9DB0C9' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#1c2740' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#111728' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#060912' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3a4a63' }] },
];
