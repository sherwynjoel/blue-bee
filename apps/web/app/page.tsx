'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loading } from '@/components/ui';

/** The console entry — sends operators to the orders queue (the hub). */
export default function Home(): React.ReactElement {
  const router = useRouter();
  useEffect(() => {
    router.replace('/orders');
  }, [router]);
  return <Loading label="Opening console…" />;
}
