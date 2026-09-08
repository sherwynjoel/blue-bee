import React from 'react';
import { StyleSheet, Text as RNText } from 'react-native';
import { render } from '@testing-library/react-native';
import { Card } from './Card';
import { lightTheme } from './theme';

describe('Card (packages/ui)', () => {
  it('renders its children', () => {
    const { getByText } = render(
      <Card>
        <RNText>Body</RNText>
      </Card>,
    );
    expect(getByText('Body')).toBeTruthy();
  });

  it('renders a title and a titleAccessory when given (customer capability)', () => {
    const { getByText } = render(
      <Card title="Quote" titleAccessory={<RNText>ACC</RNText>}>
        <RNText>Body</RNText>
      </Card>,
    );
    expect(getByText('Quote')).toBeTruthy();
    expect(getByText('ACC')).toBeTruthy();
  });

  it('applies the soft e1 shadow by default and drops it when flat (customer capability)', () => {
    const { getByTestId } = render(
      <Card testID="raised">
        <RNText>x</RNText>
      </Card>,
    );
    const raised = StyleSheet.flatten(getByTestId('raised').props.style);
    expect(raised.shadowColor).toBe(lightTheme.elevation.e1.shadowColor);

    const { getByTestId: getFlat } = render(
      <Card testID="flat" flat>
        <RNText>x</RNText>
      </Card>,
    );
    const flat = StyleSheet.flatten(getFlat('flat').props.style);
    expect(flat.shadowColor).toBeUndefined();
  });

  it('defaults padding to the theme card padding', () => {
    const { getByTestId } = render(
      <Card testID="c">
        <RNText>x</RNText>
      </Card>,
    );
    expect(StyleSheet.flatten(getByTestId('c').props.style).padding).toBe(lightTheme.cardPadding);
  });

  it('honors an explicit numeric padding (customer) and driver/owner padded={false}', () => {
    const { getByTestId } = render(
      <Card testID="zero" padding={0}>
        <RNText>x</RNText>
      </Card>,
    );
    expect(StyleSheet.flatten(getByTestId('zero').props.style).padding).toBe(0);

    const { getByTestId: getPadded } = render(
      <Card testID="np" padded={false}>
        <RNText>x</RNText>
      </Card>,
    );
    expect(StyleSheet.flatten(getPadded('np').props.style).padding).toBe(0);
  });
});
