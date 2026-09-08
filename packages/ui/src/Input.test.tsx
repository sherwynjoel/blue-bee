import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { Feather } from '@expo/vector-icons';
import { Input } from './Input';
import { lightTheme } from './theme';

describe('Input (packages/ui)', () => {
  it('renders a label when given (customer capability)', () => {
    const { getByText } = render(<Input label="Your phone number" value="" onChangeText={() => undefined} />);
    expect(getByText('Your phone number')).toBeTruthy();
  });

  it('forwards value + onChangeText and arbitrary TextInputProps (extends TextInputProps)', () => {
    const onChangeText = jest.fn();
    const { getByTestId } = render(
      <Input testID="phone" value="416" onChangeText={onChangeText} placeholder="+1" keyboardType="phone-pad" />,
    );
    const field = getByTestId('phone');
    expect(field.props.value).toBe('416');
    expect(field.props.placeholder).toBe('+1');
    fireEvent.changeText(field, '4165');
    expect(onChangeText).toHaveBeenCalledWith('4165');
  });

  it('shows the error message and a danger border when `error` is set (customer capability)', () => {
    const { getByText, getByTestId } = render(
      <Input testID="pw" value="" onChangeText={() => undefined} error="Too short" />,
    );
    expect(getByText('Too short')).toBeTruthy();
    // Climb from the TextInput to the bordered field wrapper and assert the danger border resolved.
    let node = getByTestId('pw').parent;
    let borderColor: string | undefined;
    while (node) {
      const flat = StyleSheet.flatten(node.props.style) as { borderColor?: string } | undefined;
      if (flat?.borderColor) {
        borderColor = flat.borderColor;
        break;
      }
      node = node.parent;
    }
    expect(borderColor).toBe(lightTheme.colors.danger);
  });

  it('shows a hint under the field when there is no error (customer capability)', () => {
    const { getByText, queryByText } = render(
      <Input value="" onChangeText={() => undefined} hint="At least 8 characters." />,
    );
    expect(getByText('At least 8 characters.')).toBeTruthy();
    expect(queryByText('Too short')).toBeNull();
  });

  it('renders a leading icon when `icon` is set', () => {
    const { UNSAFE_queryAllByType } = render(<Input value="" onChangeText={() => undefined} icon="phone" />);
    expect(UNSAFE_queryAllByType(Feather)).toHaveLength(1);
  });

  it('renders big OTP figures when `big` is set (driver/owner capability)', () => {
    const { getByTestId } = render(<Input testID="otp" value="123" onChangeText={() => undefined} big />);
    const flat = StyleSheet.flatten(getByTestId('otp').props.style);
    expect(flat.fontSize).toBe(26);
    expect(flat.letterSpacing).toBe(6);
  });
});
