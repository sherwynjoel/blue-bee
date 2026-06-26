import { AccountDetail } from '@/components/AccountDetail';

export default function AccountDetailPage({ params }: { params: { id: string } }): React.ReactElement {
  return <AccountDetail accountId={params.id} />;
}
