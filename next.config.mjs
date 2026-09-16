/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // pino / ioredis / bullmq must stay external to the server bundle
    serverComponentsExternalPackages: ['pino', 'pino-pretty', 'ioredis', 'bullmq', 'tiktoken'],
  },
  // Expose OpenAI-style paths: /v1/chat/completions -> /api/v1/chat/completions
  async rewrites() {
    return [{ source: '/v1/:path*', destination: '/api/v1/:path*' }];
  },
};
export default nextConfig;
