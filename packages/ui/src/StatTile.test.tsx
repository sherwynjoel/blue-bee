import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { Feather } from '@expo/vector-icons';
import { StatTile, type StatTileProps } from './StatTile';
import { lightTheme, toneColors } from './theme';

describe('StatTile (packages/ui)', () => {
  it('renders its value and label', () => {
    const { getByText } = render(<StatTile value="128" label="Orders today" />);
    expect(getByText('128')).toBeTruthy();
    expect(getByText('Orders today')).toBeTruthy();
  });

  it('wraps in a raised card by default (driver/owner KPI shape) and drops the chrome when card={false} (customer inline shape)', () => {
    const { getByTestId } = render(<StatTile testID="kpi" value="9" label="In flight" />);
    const carded = StyleSheet.flatten(getByTestId('kpi').props.style);
    expect(carded.backgroundColor).toBe(lightTheme.colors.surface);
    expect(carded.shadowColor).toBe(lightTheme.elevation.e1.shadowColor);

    const { getByTestId: getBare } = render(<StatTile testID="bare" value="9" label="Total" card={false} />);
    const bare = StyleSheet.flatten(getBare('bare').props.style);
    expect(bare.backgroundColor).toBeUndefined();
    expect(bare.shadowColor).toBeUndefined();
  });

  it('renders an icon chip when `icon` is set (customer capability)', () => {
    const { UNSAFE_queryAllByType } = render(<StatTile value="128" label="Total" icon="package" card={false} />);
    expect(UNSAFE_queryAllByType(Feather)).toHaveLength(1);
  });

  it('renders a hint line when `hint` is set (driver/owner capability)', () => {
    const { getByText } = render(<StatTile value="6.5 kg" label="Authoritative" hint="from booking" />);
    expect(getByText('from booking')).toBeTruthy();
  });

  it('targets the value node via valueTestID (driver/owner capability)', () => {
    const { getByTestId } = render(<StatTile value="42" label="Orders" valueTestID="kpi-value" />);
    expect(getByTestId('kpi-value')).toBeTruthy();
  });

  it('tints the value in the tone hue only when `emphasize` is set', () => {
    const { getByTestId } = render(
      <StatTile value="$15" label="Credits" tone="success" emphasize valueTestID="v" card={false} />,
    );
    expect(StyleSheet.flatten(getByTestId('v').props.style).color).toBe(toneColors(lightTheme.colors, 'success').ink);

    const { getByTestId: getPlain } = render(
      <StatTile value="$15" label="Credits" tone="success" valueTestID="v2" card={false} />,
    );
    expect(StyleSheet.flatten(getPlain('v2').props.style).color).toBe(lightTheme.colors.text);
  });

  const tones: NonNullable<StatTileProps['tone']>[] = ['azure', 'honey', 'success', 'warning', 'danger', 'neutral'];
  it.each(tones)('renders tone=%s without crashing', (tone) => {
    const { getByText } = render(<StatTile value="1" label={tone} tone={tone} icon="star" />);
    expect(getByText(tone)).toBeTruthy();
  });
});
