interface NautexDesktopBridge {
  readonly workspace: "operational" | "demonstration";
  readonly backendOrigin: string;
  readonly deploymentMode: "standalone" | "office-host" | "office-client" | "development";
  readonly usesApiProxy: true;
  readonly platform: "win32";
  openExternal(url: string): Promise<void>;
  openDownload(url: string): Promise<void>;
  onDeepLink(listener: (url: string) => void): () => void;
}

interface Window {
  readonly nautexDesktop?: NautexDesktopBridge;
}
