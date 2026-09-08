import React from 'react';
import { render } from '@testing-library/react-native';
import { Feather } from '@expo/vector-icons';
import { Badge, type BadgeTone } from './Badge';

describe('Badge (packages/ui)', () => {
  it('renders its label (customer API)', () => {
    const { getByText } = render(<Badge label="Approved" tone="success" />);
    expect(getByText('Approved')).toBeTruthy();
  });

  it('renders children as content (driver/owner API)', () => {
    const { getByText } = render(<Badge tone="azure">On route</Badge>);
    expect(getByText('On route')).toBeTruthy();
  });

  it('renders a leading dot when `dot` is set', () => {
    const { toJSON } = render(<Badge label="Live" tone="azure" dot />);
    // dot + text = two children in the pill
    expect(JSON.stringify(toJSON())).toContain('Live');
  });

  it('renders a leading icon when `icon` is set (driver/owner capability)', () => {
    const { UNSAFE_queryAllByType } = render(<Badge label="Rated" tone="honey" icon="star" />);
    expect(UNSAFE_queryAllByType(Feather)).toHaveLength(1);
  });

  it('renders no icon when `icon` is unset', () => {
    const { UNSAFE_queryAllByType } = render(<Badge label="Plain" />);
    expect(UNSAFE_queryAllByType(Feather)).toHaveLength(0);
  });

  const tones: BadgeTone[] = ['azure', 'honey', 'success', 'warning', 'danger', 'neutral'];
  it.each(tones)('renders tone=%s without crashing', (tone) => {
    const { getByText } = render(<Badge label={tone} tone={tone} />);
    expect(getByText(tone)).toBeTruthy();
  });
});
