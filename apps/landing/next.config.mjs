/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Static export for Cloudflare Pages
  output: "export",
  images: {
    formats: ["image/avif", "image/webp"],
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
};

export default config;
