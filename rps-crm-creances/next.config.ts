import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // chargement manuel des 4 fichiers du pont (plusieurs Mo)
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
