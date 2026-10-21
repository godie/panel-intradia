import type { NextConfig } from "next";

/**
 * Security headers (server-side, all routes):
 * - nosniff: browsers never MIME-sniff responses (defense against a JSON
 *   response being interpreted as HTML).
 * - DENY frame: no clickjacking on the dashboard.
 * - Strict budget of permissions and referrer.
 * - CSP baseline: tudo local-origin only. `unsafe-inline` styles are
 *   required by Next.js inline style hydration; `unsafe-eval` in scripts
 *   is required by the dev/runtime tooling. `ws:/wss:` in connect-src
 *   keeps the Socket.IO mini-services (ticks, order book) working through
 *   the Caddy gateway. NO external origins are allowed anywhere.
 */
const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
