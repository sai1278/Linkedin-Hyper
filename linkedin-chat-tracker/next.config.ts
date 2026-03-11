/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { hostname: 'media.licdn.com' },
      { hostname: 'static.licdn.com' }
    ]
  }
};

export default nextConfig;
