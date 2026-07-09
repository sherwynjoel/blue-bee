import { CatalogAdmin } from '@/components/CatalogAdmin';
import { ServiceMenuAdmin } from '@/components/ServiceMenuAdmin';

export default function CatalogPage(): React.ReactElement {
  return (
    <div className="space-y-10">
      {/* Inc-21 — the 8 top-level Home service cards + per-unit rate editor (where real CAD prices are entered). */}
      <ServiceMenuAdmin />
      {/* Inc-17 — the dry-clean garment sub-catalog (nested under the Dry Cleaning card). */}
      <CatalogAdmin />
    </div>
  );
}
