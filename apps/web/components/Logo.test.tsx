import React from 'react';
import { render, screen } from '@testing-library/react';
import { BeeMark, Logo } from './Logo';

describe('Logo (brand mark + wordmark)', () => {
  it('renders the "Blue Bee" wordmark and an accessible mark', () => {
    render(<Logo />);
    expect(screen.getByText('Blue Bee')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /blue bee/i })).toBeInTheDocument();
  });

  it('BeeMark exposes an accessible label (used standalone for the favicon glyph)', () => {
    render(<BeeMark />);
    expect(screen.getByRole('img', { name: /blue bee/i })).toBeInTheDocument();
  });
});
