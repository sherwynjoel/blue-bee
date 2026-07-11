import { CustomerDetail } from '@/components/CustomerDetail';

export default function CustomerDetailPage({ params }: { params: { id: string } }): React.ReactElement {
  return <CustomerDetail userId={params.id} />;
}
