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
      items: [{ id: 'item-1', name: 'Dress shirt', imageUrl: 'https://minio.local/x.png?sig=1', price: '6.00', priceSource: 'service_base', sortOrder: 0 }],
    },
  ],
  ...over,
});

const item = (id: string, name: string, sortOrder: number): DrycleanCatalogView['categories'][number]['items'][number] => ({
  id,
  name,
  imageUrl: null,
  price: '6.00',
  priceSource: 'service_base',
  sortOrder,
});
const category = (id: string, name: string, sortOrder: number, items: DrycleanCatalogView['categories'][number]['items']): DrycleanCatalogView['categories'][number] => ({
  id,
  name,
  description: null,
  features: [],
  icon: null,
  priceFrom: '6.00',
  sortOrder,
  items,
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

  // [Inc-24] The console's drag/arrow reorder persists sortOrder; the picker must render in THAT order.
  // The payload is deliberately scrambled so the assertion proves ordering-by-sortOrder, not order-of-arrival.
  it('renders categories in sortOrder, and each category’s items in sortOrder', () => {
    const scrambled = catalog({
      categories: [
        category('cat-b', 'Outerwear', 2, [item('item-b2', 'Blazer', 1), item('item-b1', 'Winter coat', 0)]),
        category('cat-a', 'Shirts', 1, [item('item-a2', 'Blouse', 1), item('item-a1', 'Dress shirt', 0)]),
      ],
    });
    const { getAllByTestId, getAllByText } = render(<DrycleanPicker catalog={scrambled} qtyFor={() => 0} onAdd={jest.fn()} onRemove={jest.fn()} />);

    const categoryOrder = getAllByTestId(/^dryclean-category-/).map((n) => n.props.testID);
    expect(categoryOrder).toEqual(['dryclean-category-cat-a', 'dryclean-category-cat-b']);

    const photoOrder = getAllByTestId(/^dryclean-price-/).map((n) => n.props.testID);
    expect(photoOrder).toEqual(['dryclean-price-item-a1', 'dryclean-price-item-a2', 'dryclean-price-item-b1', 'dryclean-price-item-b2']);

    // sanity: the names really are the reordered ones
    expect(getAllByText('Dress shirt')).toHaveLength(1);
  });
});
