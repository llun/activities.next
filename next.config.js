/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,

  async rewrites() {
    return [
      {
        source: "/.well-known/:path*",
        destination: "/api/well-known/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
