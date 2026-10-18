import { SiteHeader } from "@/components/SiteChrome";
import "../products/catalog.css";
import "./creators.css";

export default function CreatorsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="catalog-theme">
      <SiteHeader />
      {children}
    </div>
  );
}