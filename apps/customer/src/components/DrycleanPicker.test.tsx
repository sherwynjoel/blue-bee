import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { DrycleanCatalogView } from '@blue-bee/shared';
import { DrycleanPicker } from './DrycleanPicker';

jest.setTimeout(30000); // jest-expo cold render on the external drive can exceed the 5s default

const catalog = (over: Partial<DrycleanCatalogView> = {}): DrycleanCatalogView => ({
  currency: 'CAD',
  pricingAccountName: null,
  categories: [
    {
      id: 'cat-1',
      name: 'Shirts',
      description: 'Crisp shirts and blouses.',
      features: ['DRY CLEAN', 'PRESS'],
      icon: 'shirts',
      priceFrom: '6.00',
      sortOrder: 1,
      items: [{ id: 'item-1', name: 'Dress shirt', imageUrl: 'https://minio.local/x.png?sig=1', price: '6.00', priceSource: 'service_base' }],
    },
  ],
  ...over,
});

describe('DrycleanPicker (visual dry-clean picker)', () => {
  it('renders categories → items with photo + name + (server-resolved) price', () => {
    const { getByTestId, getByText } = render(<DrycleanPicker catalog={catalog()} qtyFor={() => 0} onAdd={jest.fn()} onRemove={jest.fn()} />);
    expect(getByTestId('dryclean-category-cat-1')).toBeTruthy();
    expect(getByText('Dress shirt')).toBeTruthy();
    expect(getByTestId('dryclean-photo-item-1')).toBeTruthy();
    expect(getByTestId('dryclean-price-item-1')).toBeTruthy();
  });

  it('tapping + adds one unit (feeds the existing draft-item list — no parallel cart)', () => {
    const onAdd = jest.fn();
    const { getByLabelText } = render(<DrycleanPicker catalog={catalog()} qtyFor={() => 0} onAdd={onAdd} onRemove={jest.fn()} />);
    fireEvent.press(getByLabelText('Add one Dress shirt'));
    expect(onAdd).toHaveBeenCalledWith('item-1');
  });

  it('shows the quantity + a − control once an item is selected, and − removes one', () => {
    const onRemove = jest.fn();
    const { getByTestId, getByLabelText } = render(<DrycleanPicker catalog={catalog()} qtyFor={() => 2} onAdd={jest.fn()} onRemove={onRemove} />);
    expect(getByTestId('dryclean-qty-item-1').props.children).toBe(2);
    fireEvent.press(getByLabelText('Remove one Dress shirt'));
    expect(onRemove).toHaveBeenCalledWith('item-1');
  });

  it('shows the corporate-pricing note when the server resolved a corporate account', () => {
    const { getByTestId } = render(<DrycleanPicker catalog={catalog({ pricingAccountName: 'Maple District Towers' })} qtyFor={() => 0} onAdd={jest.fn()} onRemove={jest.fn()} />);
    expect(getByTestId('dryclean-corp-note')).toBeTruthy();
  });

  it('renders nothing when there are no categories (degrades cleanly)', () => {
    const { toJSON } = render(<DrycleanPicker catalog={catalog({ categories: [] })} qtyFor={() => 0} onAdd={jest.fn()} onRemove={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });
});
