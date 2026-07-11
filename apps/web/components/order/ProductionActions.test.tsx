import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrderStatus, RoleType, type MeResponse } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import type { OrderDetail } from '@/lib/types';

const mockClient = {
  startCleaning: jest.fn(),
  sendToQc: jest.fn(),
  recordQc: jest.fn(),
  rewashOrder: jest.fn(),
};
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { ProductionActions } from './ProductionActions';

function me(...roles: RoleType[]): MeResponse {
  return {
    user: { userId: 'u', orgId: 'g', name: 'Plant', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] },
    org: { id: 'g', name: 'Org' },
  };
}

/** A minimal order — the component only reads `id` + `status`. */
const order = (status: OrderStatus): OrderDetail => ({ id: 'order-1', status } as OrderDetail);

/** The server echoes back the advanced order; the component hands it to onChanged. */
const advancedTo = (status: OrderStatus): OrderDetail => order(status);

describe('ProductionActions (Inc-30 — console plant advance)', () => {
  beforeEach(() => {
    Object.values(mockClient).forEach((m) => m.mockReset());
    mockMe = me(RoleType.PLANT_OP);
  });

  it('renders nothing for a non-production role', () => {
    mockMe = me(RoleType.DISPATCHER);
    const { container } = render(<ProductionActions order={order(OrderStatus.QUOTE_APPROVED)} onChanged={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the order is not at a production step', () => {
    const { container } = render(<ProductionActions order={order(OrderStatus.QUOTED)} onChanged={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers "Start cleaning" at QUOTE_APPROVED and calls startCleaning', async () => {
    const onChanged = jest.fn();
    mockClient.startCleaning.mockResolvedValue(advancedTo(OrderStatus.IN_CLEANING));
    render(<ProductionActions order={order(OrderStatus.QUOTE_APPROVED)} onChanged={onChanged} />);

    fireEvent.click(screen.getByTestId('prod-start-cleaning'));
    await waitFor(() => expect(mockClient.startCleaning).toHaveBeenCalledWith('order-1'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: OrderStatus.IN_CLEANING })));
  });

  it('offers "Send to QC" + "Rewash" while IN_CLEANING; Send to QC advances', async () => {
    mockClient.sendToQc.mockResolvedValue(advancedTo(OrderStatus.QC));
    render(<ProductionActions order={order(OrderStatus.IN_CLEANING)} onChanged={jest.fn()} />);
    expect(screen.getByTestId('prod-rewash')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('prod-send-to-qc'));
    await waitFor(() => expect(mockClient.sendToQc).toHaveBeenCalledWith('order-1'));
  });

  it('records a QC pass (mark ready) at QC', async () => {
    mockClient.recordQc.mockResolvedValue(advancedTo(OrderStatus.READY));
    render(<ProductionActions order={order(OrderStatus.QC)} onChanged={jest.fn()} />);

    fireEvent.click(screen.getByTestId('prod-pass-qc'));
    await waitFor(() => expect(mockClient.recordQc).toHaveBeenCalledWith('order-1', { result: 'pass' }));
  });

  it('records a QC fail with a reason (modal) → recordQc(fail)', async () => {
    mockClient.recordQc.mockResolvedValue(advancedTo(OrderStatus.REWASH));
    render(<ProductionActions order={order(OrderStatus.QC)} onChanged={jest.fn()} />);

    fireEvent.click(screen.getByTestId('prod-fail-qc'));
    fireEvent.change(screen.getByLabelText('Rewash reason'), { target: { value: 'fringe still soiled' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));

    await waitFor(() => expect(mockClient.recordQc).toHaveBeenCalledWith('order-1', { result: 'fail', reason: 'fringe still soiled' }));
  });

  it('will not submit a rewash with a blank reason', () => {
    render(<ProductionActions order={order(OrderStatus.IN_CLEANING)} onChanged={jest.fn()} />);
    fireEvent.click(screen.getByTestId('prod-rewash'));
    // Send-back is disabled until the reason is ≥3 chars, so a click does nothing.
    expect(screen.getByRole('button', { name: 'Send back' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    expect(mockClient.rewashOrder).not.toHaveBeenCalled();
  });

  it('offers "Restart cleaning" from REWASH', async () => {
    mockClient.startCleaning.mockResolvedValue(advancedTo(OrderStatus.IN_CLEANING));
    render(<ProductionActions order={order(OrderStatus.REWASH)} onChanged={jest.fn()} />);
    fireEvent.click(screen.getByTestId('prod-restart-cleaning'));
    await waitFor(() => expect(mockClient.startCleaning).toHaveBeenCalledWith('order-1'));
  });

  it('surfaces a 409 as "moved on — refresh", not a silent success', async () => {
    mockClient.startCleaning.mockRejectedValue(new ApiError(409, { title: 'illegal_transition', status: 409 }, 'concurrently modified'));
    const onChanged = jest.fn();
    render(<ProductionActions order={order(OrderStatus.QUOTE_APPROVED)} onChanged={onChanged} />);

    fireEvent.click(screen.getByTestId('prod-start-cleaning'));
    await waitFor(() => expect(screen.getByTestId('prod-error')).toHaveTextContent(/moved on/i));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
