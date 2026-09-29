import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@vispr/contracts'],
  async redirects() {
    return [{ source: '/', destination: '/playground', permanent: false }];
  },
};
export default config;
