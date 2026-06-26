import { OrderDetailView } from '@/components/OrderDetail';

export default function OrderDetailPage({ params }: { params: { id: string } }): React.ReactElement {
  return <OrderDetailView orderId={params.id} />;
}
