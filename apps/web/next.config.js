/** @type {import('next').NextConfig} */
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  // Disable PWA in development to avoid service worker noise
  disable: process.env.NODE_ENV === 'development',
});

const nextConfig = {
  reactStrictMode: true,
  // No public env vars should ever carry secrets.
  // All NEXT_PUBLIC_ vars are safe for client.
};

module.exports = withPWA(nextConfig);
