import { PortalInvoiceDetail } from '@/components/PortalInvoiceDetail';

/** Account-customer invoice detail (server component reads the param, renders the client view). */
export default function Page({ params }: { params: { id: string } }): React.ReactElement {
  return <PortalInvoiceDetail invoiceId={params.id} />;
}
