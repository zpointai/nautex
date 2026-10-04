import React from "react";
import ReactDOM from "react-dom/client";
import { DesktopRuntimeBoundary } from "@/components/desktop/desktop-runtime-boundary";
import { NautexErpApp } from "@/components/nautex-erp-app";
import "@/app/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DesktopRuntimeBoundary>
      <NautexErpApp />
    </DesktopRuntimeBoundary>
  </React.StrictMode>,
);
