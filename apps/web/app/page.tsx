'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { isOps, isPortal } from '@/lib/rbac';
import { Loading } from '@/components/ui';

/**
 * The app entry — routes by role: a B2B account customer (ACCOUNT_ADMIN/ACCOUNT_STAFF, not ops) lands
 * in the self-serve invoice portal; everyone else goes to the operator console (which gates / shows
 * Login as appropriate). The destinations stay authoritative server-side.
 */
export default function Home(): React.ReactElement {
  const router = useRouter();
  const { status, me } = useSession();
  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'signedIn' && isPortal(me) && !isOps(me)) router.replace('/portal');
    else router.replace('/orders');
  }, [status, me, router]);
  return <Loading label="Opening Blue Bee…" />;
}
