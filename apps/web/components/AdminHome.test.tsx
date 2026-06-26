import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RoleType, type MeResponse } from '@blue-bee/shared';

const mockClient = {
  adminListUsers: jest.fn(),
  adminAssignRole: jest.fn(),
  adminRevokeRole: jest.fn(),
  adminListDevices: jest.fn(),
  adminCreateDevice: jest.fn(),
  adminDeleteDevice: jest.fn(),
  adminListDrivers: jest.fn(),
  adminAssignDriverVehicle: jest.fn(),
  adminNotificationConfig: jest.fn(),
  adminAuditLogs: jest.fn(),
  listVehicles: jest.fn(),
};
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { AdminHome } from './AdminHome';

function me(...roles: RoleType[]): MeResponse {
  return {
    user: {
      userId: 'u',
      orgId: 'g',
      name: 'Owner',
      phone: null,
      email: null,
      roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })),
      accountIds: [],
      siteIds: [],
    },
    org: { id: 'g', name: 'Org' },
  };
}

const usersResult = {
  users: [
    { id: 'user-1', name: 'Alice', phone: '+1', email: null, status: 'ACTIVE', roles: [{ id: 'g1', role: 'CSR', scope: 'ORG', scopeId: null }] },
    { id: 'user-2', name: 'Bob', phone: null, email: 'bob@x.com', status: 'ACTIVE', roles: [] },
  ],
  count: 2,
};
const devicesResult = {
  devices: [{ id: 'dev-1', userId: 'user-1', userName: 'Alice', platform: 'IOS', pushTokenMasked: '…abcd', lastSeen: null, createdAt: 'c' }],
  count: 1,
};
const driversResult = { drivers: [{ id: 'drv-1', userId: 'user-1', name: 'Alice', license: null, defaultVehicleId: null }], count: 1 };
const vehicles = [{ id: 'veh-1', label: 'Van 1', status: 'ACTIVE' }];
const notifConfig = {
  appName: 'Blue Bee',
  events: [{ event: 'geofence.approaching', channels: ['PUSH', 'SMS', 'EMAIL'], urgent: true }],
  quietHours: { policy: 'defer', defaultTimezone: 'America/Toronto' },
  templatesEditable: false,
  note: 'Templates are static code-config; read-only viewer.',
};
const auditResult = {
  entries: [
    { id: 'a1', entity: 'UserRole', entityId: 'g1', action: 'ROLE_ASSIGNED', actorId: 'u', actorName: 'Owner', at: '2026-06-26T10:00:00Z', before: null, after: null },
  ],
  nextCursor: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.OWNER);
  mockClient.adminListUsers.mockResolvedValue(usersResult);
  mockClient.adminListDevices.mockResolvedValue(devicesResult);
  mockClient.adminListDrivers.mockResolvedValue(driversResult);
  mockClient.listVehicles.mockResolvedValue(vehicles);
  mockClient.adminNotificationConfig.mockResolvedValue(notifConfig);
  mockClient.adminAuditLogs.mockResolvedValue(auditResult);
  mockClient.adminAssignRole.mockResolvedValue({ userId: 'user-2', roles: [] });
  mockClient.adminRevokeRole.mockResolvedValue({ userId: 'user-1', roles: [] });
  mockClient.adminCreateDevice.mockResolvedValue({ id: 'dev-2' });
  mockClient.adminDeleteDevice.mockResolvedValue(undefined);
});

describe('AdminHome (OWNER-gated admin console)', () => {
  it('renders users with role chips and the notification config (read-only)', async () => {
    render(<AdminHome />);
    await waitFor(() => expect(screen.getByTestId('user-user-1')).toBeInTheDocument());
    expect(within(screen.getByTestId('user-user-1')).getByText('Csr')).toBeInTheDocument();
    // notification config read-only viewer
    await waitFor(() => expect(screen.getByTestId('notif-geofence.approaching')).toBeInTheDocument());
    expect(screen.getByText(/read-only viewer/i)).toBeInTheDocument();
  });

  it('assigns a role to a user', async () => {
    render(<AdminHome />);
    await waitFor(() => expect(screen.getByLabelText('Assign user')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Assign user'), { target: { value: 'user-2' } });
    fireEvent.change(screen.getByLabelText('Assign role'), { target: { value: 'DISPATCHER' } });
    fireEvent.click(screen.getByText('Assign role'));
    await waitFor(() =>
      expect(mockClient.adminAssignRole).toHaveBeenCalledWith('user-2', { role: 'DISPATCHER', scope: 'ORG', scopeId: null }),
    );
  });

  it('revokes a role via the chip ×', async () => {
    render(<AdminHome />);
    await waitFor(() => expect(screen.getByTestId('user-user-1')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Revoke CSR from Alice'));
    await waitFor(() => expect(mockClient.adminRevokeRole).toHaveBeenCalledWith('user-1', 'g1'));
  });

  it('adds and removes a device', async () => {
    render(<AdminHome />);
    await waitFor(() => expect(screen.getByTestId('device-dev-1')).toBeInTheDocument());
    // remove
    fireEvent.click(within(screen.getByTestId('device-dev-1')).getByText('Remove'));
    await waitFor(() => expect(mockClient.adminDeleteDevice).toHaveBeenCalledWith('dev-1'));
    // add
    fireEvent.change(screen.getByLabelText('Device user'), { target: { value: 'user-1' } });
    fireEvent.click(screen.getByText('Add device'));
    await waitFor(() => expect(mockClient.adminCreateDevice).toHaveBeenCalled());
  });

  it('renders the audit log and applies a filter', async () => {
    render(<AdminHome />);
    await waitFor(() => expect(screen.getByTestId('audit-a1')).toBeInTheDocument());
    expect(within(screen.getByTestId('audit-a1')).getByText('ROLE_ASSIGNED')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter entity'), { target: { value: 'Device' } });
    fireEvent.click(screen.getByText('Filter'));
    await waitFor(() =>
      expect(mockClient.adminAuditLogs).toHaveBeenCalledWith(expect.objectContaining({ entity: 'Device' })),
    );
  });

  it('blocks a non-OWNER with a no-access notice and no fetch', async () => {
    mockMe = me(RoleType.DISPATCHER);
    render(<AdminHome />);
    expect(screen.getByText(/don’t have access/)).toBeInTheDocument();
    expect(mockClient.adminListUsers).not.toHaveBeenCalled();
  });
});
