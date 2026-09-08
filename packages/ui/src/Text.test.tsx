import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { Text } from './Text';
import { lightTheme, MONO } from './theme';

const flat = (node: { props: { style?: unknown } }): Record<string, unknown> =>
  StyleSheet.flatten(node.props.style) as Record<string, unknown>;

describe('Text (packages/ui)', () => {
  it('renders its children', () => {
    const { getByText } = render(<Text>Hello</Text>);
    expect(getByText('Hello')).toBeTruthy();
  });

  it('resolves a semantic color name through the theme (customer capability)', () => {
    const { getByTestId } = render(
      <Text testID="t" color="secondary">
        x
      </Text>,
    );
    expect(flat(getByTestId('t')).color).toBe(lightTheme.colors.textSecondary);
  });

  it('defaults to the primary text color when no color is given', () => {
    const { getByTestId } = render(<Text testID="t">x</Text>);
    expect(flat(getByTestId('t')).color).toBe(lightTheme.colors.text);
  });

  it('maps the azure semantic name to the brand hue', () => {
    const { getByTestId } = render(
      <Text testID="t" color="azure">
        x
      </Text>,
    );
    expect(flat(getByTestId('t')).color).toBe(lightTheme.colors.azure);
  });

  it('passes a raw color string through unchanged (driver/owner capability)', () => {
    const { getByTestId } = render(
      <Text testID="t" color="#123456">
        x
      </Text>,
    );
    expect(flat(getByTestId('t')).color).toBe('#123456');
  });

  it('applies the type scale for the given variant', () => {
    const cases = ['title1', 'body', 'caption'] as const;
    cases.forEach((variant) => {
      const { getByTestId } = render(
        <Text testID={variant} variant={variant}>
          x
        </Text>,
      );
      const style = flat(getByTestId(variant));
      expect(style.fontSize).toBe(lightTheme.type[variant].fontSize);
      expect(style.lineHeight).toBe(lightTheme.type[variant].lineHeight);
    });
  });

  it('applies monospace + tabular figures when `mono` is set', () => {
    const { getByTestId } = render(
      <Text testID="t" mono>
        12:45
      </Text>,
    );
    const style = flat(getByTestId('t'));
    expect(style.fontFamily).toBe(MONO);
    expect(style.fontVariant).toEqual(['tabular-nums']);
  });

  it('applies tabular figures (without monospace) when `tabular` is set', () => {
    const { getByTestId } = render(
      <Text testID="t" tabular>
        128
      </Text>,
    );
    const style = flat(getByTestId('t'));
    expect(style.fontVariant).toEqual(['tabular-nums']);
    expect(style.fontFamily).toBeUndefined();
  });

  it('forwards RN Text props (numberOfLines) to the host', () => {
    const { getByTestId } = render(
      <Text testID="t" numberOfLines={1}>
        long
      </Text>,
    );
    expect(getByTestId('t').props.numberOfLines).toBe(1);
  });
});
