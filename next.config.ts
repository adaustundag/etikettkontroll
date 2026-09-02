import type { NextConfig } from "next";

// Always-on hardening (audit: no security headers at all). HSTS is ignored
// over plain HTTP, so it is safe to send unconditionally.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
];

// Production-only additions. The dev preview panel embeds the app in a
// cross-origin iframe, so strict frame + permissions policies would break it
// in development; they apply when NODE_ENV=production (override: FRAME_POLICY=off).
const productionHeaders =
  process.env.NODE_ENV === "production" && process.env.FRAME_POLICY !== "off"
    ? [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        {
          key: "Content-Security-Policy",
          value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
        },
        {
          key: "Permissions-Policy",
          value: "camera=(self), microphone=(), geolocation=(), payment=()",
        },
      ]
    : [];

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    return [
      // The service worker script itself must never be sticky — a cached old
      // sw.js delays update detection after deploys.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { source: "/:path*", headers: [...securityHeaders, ...productionHeaders] },
    ];
  },
};

export default nextConfig;
