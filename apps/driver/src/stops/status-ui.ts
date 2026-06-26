import { RouteStopStatus } from '@blue-bee/shared';
import type { Tone } from '../theme';
import type { FeatherName } from '../components/kit';

/** Title-case a SCREAMING_SNAKE status for display. */
function humanize(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Map a §5.4 stop status to its Daylight tone, label, and icon (one source of truth for both screens). */
export function stopStatusMeta(status: string): { tone: Tone; label: string; icon: FeatherName } {
  switch (status) {
    case RouteStopStatus.COMPLETED:
      return { tone: 'success', label: 'Completed', icon: 'check-circle' };
    case RouteStopStatus.FAILED:
      return { tone: 'danger', label: 'Failed', icon: 'x-circle' };
    case RouteStopStatus.SKIPPED:
      return { tone: 'warning', label: 'Skipped', icon: 'skip-forward' };
    case RouteStopStatus.EN_ROUTE:
      return { tone: 'azure', label: 'En route', icon: 'navigation' };
    case RouteStopStatus.ARRIVED:
      return { tone: 'azure', label: 'Arrived', icon: 'map-pin' };
    case RouteStopStatus.IN_PROGRESS:
      return { tone: 'azure', label: 'In progress', icon: 'loader' };
    default:
      return { tone: 'neutral', label: humanize(status), icon: 'circle' };
  }
}
