import { NautexErpApp } from "@/components/nautex-erp-app";
import { DesktopRuntimeBoundary } from "@/components/desktop/desktop-runtime-boundary";

export default function HomePage() {
  return <DesktopRuntimeBoundary><NautexErpApp /></DesktopRuntimeBoundary>;
}

