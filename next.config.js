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
      {
        source: "/users/:path*",
        destination: "/api/users/:path*",
      },
      {
        source: "/inbox",
        destination: "/api/inbox",
      },
    ];
  },
};

module.exports = nextConfig;
