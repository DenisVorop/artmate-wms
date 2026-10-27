import type { NextConfig } from "next";
import { resolve } from "node:path";
const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(__dirname, "../.."),
  // WB read-only statistics can require paced requests lasting several minutes.
  experimental: { proxyTimeout: 270000 },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4080"}/api/:path*`,
      },
    ];
  },
};
export default config;
