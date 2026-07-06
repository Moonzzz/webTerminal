/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  poweredByHeader: false,
  allowedDevOrigins: ["enkemacmini.local"],
};

export default nextConfig;
