import { RouteDetailView } from '@/components/RouteDetail';

export default function RoutePage({ params }: { params: { id: string } }): React.ReactElement {
  return <RouteDetailView routeId={params.id} />;
}
