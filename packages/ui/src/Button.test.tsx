import React from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { light } from '@blue-bee/design-tokens';
import { Button, type ButtonTone, type ButtonVariant } from './Button';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Button (packages/ui)', () => {
  it('renders its label', () => {
    const { getByText } = render(<Button label="Send code" />);
    expect(getByText('Send code')).toBeTruthy();
  });

  it('fires onPress and a haptic when pressed (enabled)', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<Button label="Go" onPress={onPress} />);
    fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
    // default haptic 'light' → expo-haptics impactAsync
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  });

  it('respects haptic="none" (no haptic, still fires onPress)', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<Button label="Approve" onPress={onPress} haptic="none" />);
    fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('does not fire onPress when disabled', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<Button label="Nope" onPress={onPress} disabled />);
    fireEvent.press(getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('does not fire onPress when busy, and shows a spinner instead of the label', () => {
    const onPress = jest.fn();
    const { getByRole, queryByText, UNSAFE_getByType } = render(<Button label="Saving" onPress={onPress} busy />);
    fireEvent.press(getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
    expect(queryByText('Saving')).toBeNull();
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('renders a leading icon when `icon` is set', () => {
    const { UNSAFE_queryAllByType } = render(<Button label="Map" icon="map" />);
    expect(UNSAFE_queryAllByType(Feather)).toHaveLength(1);
  });

  it('renders both leading and trailing icons (iconRight preserved from driver/owner)', () => {
    const { UNSAFE_queryAllByType } = render(<Button label="Route" icon="map" iconRight="arrow-right" />);
    expect(UNSAFE_queryAllByType(Feather)).toHaveLength(2);
  });

  it('renders no icons when neither is set', () => {
    const { UNSAFE_queryAllByType } = render(<Button label="Plain" />);
    expect(UNSAFE_queryAllByType(Feather)).toHaveLength(0);
  });

  /**
   * Regression lock for the destructive-button contrast bug: solid `danger` used to paint the bright
   * mark colour with a hard-coded white label (3.91:1, under the 4.5:1 its 17px semibold label needs)
   * on Delete account / Confirm delete in all three apps. It must use the tone's solid pair.
   */
  describe('solid tones use the contrast-safe pair, not the mark colour', () => {
    /** First non-transparent backgroundColor in the rendered tree — the button's fill. */
    const backgroundOf = (node: unknown): string | undefined => {
      if (!node || typeof node !== 'object') return undefined;
      const el = node as { props?: { style?: unknown }; children?: unknown[] };
      const flat = StyleSheet.flatten(el.props?.style as never) as { backgroundColor?: string } | undefined;
      if (flat?.backgroundColor && flat.backgroundColor !== 'transparent') return flat.backgroundColor;
      for (const child of el.children ?? []) {
        const found = backgroundOf(child);
        if (found) return found;
      }
      return undefined;
    };

    it.each([
      ['danger', light.dangerSolid, light.danger],
      ['success', light.successSolid, light.success],
    ] as const)('tone=%s fills with the solid value', (tone, expected, markColour) => {
      const tree = render(<Button label="Delete account" tone={tone} variant="solid" />).toJSON();
      const bg = backgroundOf(tree);
      expect(bg).toBe(expected);
      expect(bg).not.toBe(markColour);
    });
  });

  const tones: ButtonTone[] = ['azure', 'success', 'danger', 'neutral'];
  const variants: ButtonVariant[] = ['solid', 'outline', 'ghost'];
  it.each(tones.flatMap((tone) => variants.map((variant) => [tone, variant] as const)))(
    'renders tone=%s variant=%s without crashing',
    (tone, variant) => {
      const { getByText } = render(<Button label={`${tone}-${variant}`} tone={tone} variant={variant} />);
      expect(getByText(`${tone}-${variant}`)).toBeTruthy();
    },
  );
});
