import { CorporateDetail } from '@/components/CorporateAccounts';

export default function CorporateDetailPage({ params }: { params: { id: string } }): React.ReactElement {
  return <CorporateDetail accountId={params.id} />;
}
