import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ItemStatus } from '@blue-bee/shared';
import type { ItemView } from '@/lib/types';

const mockClient = { inspectItem: jest.fn(), presignMedia: jest.fn(), confirmMedia: jest.fn() };
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient }) }));

import { InspectionForm } from './InspectionForm';

const item: ItemView = { id: 'item-1', kind: 'RUG' as never, status: ItemStatus.RECEIVED as never, measurements: {}, inspections: [], photos: [], custodyEvents: [] };

beforeEach(() => jest.clearAllMocks());

describe('InspectionForm', () => {
  it('submits an inspection with measurements (no damage)', async () => {
    mockClient.inspectItem.mockResolvedValue({ id: 'o1' });
    const onDone = jest.fn();
    render(<InspectionForm orderId="o1" item={item} onClose={jest.fn()} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('Area (sq ft)'), { target: { value: '40' } });
    fireEvent.click(screen.getByText('Save inspection'));
    await waitFor(() => expect(mockClient.inspectItem).toHaveBeenCalledWith('o1', 'item-1', expect.objectContaining({ measurements: { sqft: 40 }, preexistingDamage: false })));
    expect(onDone).toHaveBeenCalled();
  });

  it('requires at least one measurement', async () => {
    render(<InspectionForm orderId="o1" item={item} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.click(screen.getByText('Save inspection'));
    await waitFor(() => expect(screen.getByText(/at least one measurement/i)).toBeInTheDocument());
    expect(mockClient.inspectItem).not.toHaveBeenCalled();
  });

  it('requires a damage photo when flagging pre-existing damage', async () => {
    render(<InspectionForm orderId="o1" item={item} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Area (sq ft)'), { target: { value: '40' } });
    fireEvent.click(screen.getByLabelText('Pre-existing damage'));
    fireEvent.click(screen.getByText('Save inspection'));
    await waitFor(() => expect(screen.getByText(/damage photo is required/i)).toBeInTheDocument());
    expect(mockClient.inspectItem).not.toHaveBeenCalled();
  });
});
