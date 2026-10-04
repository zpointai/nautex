import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["pdf-parse", "mammoth", "xlsx"],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;


