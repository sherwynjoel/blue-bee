import { OrderBilling } from '@/components/OrderBilling';

export default function OrderBillingPage({ params }: { params: { id: string } }): React.ReactElement {
  return <OrderBilling orderId={params.id} />;
}
