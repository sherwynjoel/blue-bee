import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DEFAULT_PICKUP_SCHEDULE, type OrgSchedule, type OrgScheduleView } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';

const mockClient = {
  adminGetSchedule: jest.fn(),
  adminUpdateSchedule: jest.fn(),
};
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: null }) }));

import { SchedulingCard, parseSchedule } from './SchedulingCard';

const FOUNDER: OrgSchedule = {
  windows: [
    { label: 'Early', start: '07:00', end: '10:00' },
    { label: 'Late', start: '16:00', end: '20:00' },
  ],
  leadTimeHours: 4,
  horizonDays: 10,
  maxPerSlot: 6,
  closedDays: [0],
};

const view = (over: Partial<OrgScheduleView> = {}): OrgScheduleView => ({
  schedule: DEFAULT_PICKUP_SCHEDULE,
  timezone: 'America/Toronto',
  source: 'default',
  ...over,
});

/** The form shape the card holds internally (strings until parsed). */
const form = (over: Partial<Parameters<typeof parseSchedule>[0]> = {}) => ({
  windows: [{ label: 'Morning', start: '09:00', end: '12:00' }],
  leadTimeHours: '2',
  horizonDays: '7',
  maxPerSlot: '',
  closedDays: [] as number[],
  ...over,
});

describe('SchedulingCard — parseSchedule (pure)', () => {
  /**
   * The card validates with `orgScheduleSchema`, the EXACT schema the API validates with. These tests pin
   * the two translations the form has to make, which the schema cannot do for it.
   */
  it('maps a blank cap to null — "no cap", not zero', () => {
    const r = parseSchedule(form({ maxPerSlot: '' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.maxPerSlot).toBeNull();
  });

  it('rejects a zero cap rather than quietly reading it as "no cap"', () => {
    const r = parseSchedule(form({ maxPerSlot: '0' }));
    expect(r.ok).toBe(false);
  });

  it('keeps a real cap as a number', () => {
    const r = parseSchedule(form({ maxPerSlot: '5' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.maxPerSlot).toBe(5);
  });

  it('trims window labels and sorts closed days', () => {
    const r = parseSchedule(form({ windows: [{ label: '  Morning  ', start: '09:00', end: '12:00' }], closedDays: [6, 0] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.windows[0]!.label).toBe('Morning');
      expect(r.value.closedDays).toEqual([0, 6]);
    }
  });

  it('surfaces the server\'s own rule for overlapping windows, before the round-trip', () => {
    const r = parseSchedule(
      form({ windows: [{ label: 'A', start: '09:00', end: '13:00' }, { label: 'B', start: '12:00', end: '15:00' }] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/overlap/i);
  });

  it.each([
    ['an inverted window', form({ windows: [{ label: 'A', start: '15:00', end: '09:00' }] })],
    ['no windows', form({ windows: [] })],
    ['a duplicate label', form({ windows: [{ label: 'Morning', start: '09:00', end: '11:00' }, { label: 'morning', start: '12:00', end: '14:00' }] })],
    ['a negative lead time', form({ leadTimeHours: '-1' })],
    ['a zero horizon', form({ horizonDays: '0' })],
    ['a fractional horizon', form({ horizonDays: '2.5' })],
    ['every day closed', form({ closedDays: [0, 1, 2, 3, 4, 5, 6] })],
  ])('rejects %s', (_name, f) => {
    expect(parseSchedule(f).ok).toBe(false);
  });

  /**
   * `Number('')` is 0. Left to coerce, a blank "notice required" box would silently save "no notice
   * required" and a blank horizon would save a zero-day one — settings the founder never chose. An empty
   * number field is unanswered, not zero. (A blank CAP is different: it genuinely means "no cap".)
   */
  it.each([
    ['a blank notice period', form({ leadTimeHours: '' }), /how much notice/i],
    ['a blank horizon', form({ horizonDays: '' }), /how many days ahead/i],
  ])('rejects %s rather than coercing the empty box to zero', (_name, f, message) => {
    const r = parseSchedule(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it('still accepts an EXPLICIT zero notice period — that is a real choice', () => {
    const r = parseSchedule(form({ leadTimeHours: '0' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.leadTimeHours).toBe(0);
  });

  it('accepts adjacent (touching) windows', () => {
    const r = parseSchedule(form({ windows: [{ label: 'AM', start: '09:00', end: '12:00' }, { label: 'PM', start: '12:00', end: '15:00' }] }));
    expect(r.ok).toBe(true);
  });
});

describe('SchedulingCard', () => {
  beforeEach(() => {
    mockClient.adminGetSchedule.mockReset();
    mockClient.adminUpdateSchedule.mockReset();
    mockClient.adminGetSchedule.mockResolvedValue(view());
  });

  it('says out loud that customers are on the DEFAULT hours until real ones are saved', async () => {
    render(<SchedulingCard />);
    expect(await screen.findByTestId('schedule-source-default')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-default-note')).toHaveTextContent(/No pickup hours have been saved yet/i);
    // The editor is seeded from the defaults, so the founder edits from a working starting point.
    expect(screen.getByLabelText('Window 1 name')).toHaveValue('Morning');
    expect(screen.getByLabelText('Window 1 start')).toHaveValue('09:00');
  });

  it('stops calling them defaults once the founder has saved their own', async () => {
    mockClient.adminGetSchedule.mockResolvedValue(view({ schedule: FOUNDER, source: 'org' }));
    render(<SchedulingCard />);
    expect(await screen.findByTestId('schedule-source-org')).toBeInTheDocument();
    expect(screen.queryByTestId('schedule-default-note')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Window 1 name')).toHaveValue('Early');
    expect(screen.getByLabelText('Max pickups per window')).toHaveValue(6);
  });

  it('names the timezone the hours are read in (they are wall-clock, not instants)', async () => {
    render(<SchedulingCard />);
    expect(await screen.findByText(/in America\/Toronto/)).toBeInTheDocument();
  });

  it('saves the edited schedule and re-reads it', async () => {
    mockClient.adminUpdateSchedule.mockResolvedValue(view({ schedule: FOUNDER, source: 'org' }));
    render(<SchedulingCard />);
    await screen.findByTestId('schedule-save');

    fireEvent.change(screen.getByLabelText('Window 1 start'), { target: { value: '08:00' } });
    fireEvent.change(screen.getByLabelText('Notice required in hours'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Max pickups per window'), { target: { value: '6' } });
    fireEvent.click(screen.getByTestId('schedule-closed-0')); // closed Sundays
    fireEvent.click(screen.getByTestId('schedule-save'));

    await waitFor(() => expect(mockClient.adminUpdateSchedule).toHaveBeenCalled());
    const [dto] = mockClient.adminUpdateSchedule.mock.calls[0]!;
    expect(dto.windows[0]).toEqual({ label: 'Morning', start: '08:00', end: '12:00' });
    expect(dto.leadTimeHours).toBe(3);
    expect(dto.maxPerSlot).toBe(6);
    expect(dto.closedDays).toEqual([0]);

    await screen.findByTestId('schedule-saved');
    expect(mockClient.adminGetSchedule).toHaveBeenCalledTimes(2); // re-read → the badge flips to "Your hours"
  });

  it('sends maxPerSlot: null when the cap is left blank — no invented scarcity', async () => {
    mockClient.adminUpdateSchedule.mockResolvedValue(view({ source: 'org' }));
    render(<SchedulingCard />);
    await screen.findByTestId('schedule-save');
    expect(screen.getByLabelText('Max pickups per window')).toHaveValue(null); // blank by default
    fireEvent.click(screen.getByTestId('schedule-save'));

    await waitFor(() => expect(mockClient.adminUpdateSchedule).toHaveBeenCalled());
    expect(mockClient.adminUpdateSchedule.mock.calls[0]![0].maxPerSlot).toBeNull();
  });

  it('blocks save on an invalid schedule and says why (the server rule, before the round-trip)', async () => {
    render(<SchedulingCard />);
    await screen.findByTestId('schedule-save');

    fireEvent.change(screen.getByLabelText('Window 1 end'), { target: { value: '08:00' } }); // ends before it starts
    expect(await screen.findByTestId('schedule-invalid')).toHaveTextContent(/end must be after start/i);
    expect(screen.getByTestId('schedule-save')).toBeDisabled();

    fireEvent.click(screen.getByTestId('schedule-save'));
    expect(mockClient.adminUpdateSchedule).not.toHaveBeenCalled();
  });

  it('adds and removes windows, and refuses to remove the last one', async () => {
    render(<SchedulingCard />);
    await screen.findByTestId('schedule-window-0');
    expect(screen.getByTestId('schedule-window-2')).toBeInTheDocument(); // 3 defaults

    fireEvent.click(screen.getByTestId('schedule-remove-window-2'));
    fireEvent.click(screen.getByTestId('schedule-remove-window-1'));
    expect(screen.queryByTestId('schedule-window-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('schedule-remove-window-0')).toBeDisabled(); // a schedule needs ≥1 window

    fireEvent.click(screen.getByTestId('schedule-add-window'));
    expect(screen.getByTestId('schedule-window-1')).toBeInTheDocument();
    // A new window starts unnamed, and an unnamed window is invalid — the founder must name it.
    expect(screen.getByTestId('schedule-invalid')).toBeInTheDocument();
  });

  it('surfaces a save failure and does not claim success', async () => {
    mockClient.adminUpdateSchedule.mockRejectedValue(new ApiError(400, { error: 'validation_failed', title: 'validation_failed', status: 400 }, 'windows overlap'));
    render(<SchedulingCard />);
    await screen.findByTestId('schedule-save');
    fireEvent.click(screen.getByTestId('schedule-save'));

    await waitFor(() => expect(screen.getByText('windows overlap')).toBeInTheDocument());
    expect(screen.queryByTestId('schedule-saved')).not.toBeInTheDocument();
  });

  it('surfaces a failed load with a retry rather than an empty editor', async () => {
    mockClient.adminGetSchedule.mockRejectedValue(new ApiError(503, { error: 'x', title: 'x', status: 503 }, 'Service unavailable'));
    render(<SchedulingCard />);
    await waitFor(() => expect(screen.getByText('Service unavailable')).toBeInTheDocument());
    expect(screen.queryByTestId('schedule-save')).not.toBeInTheDocument();
  });
});
