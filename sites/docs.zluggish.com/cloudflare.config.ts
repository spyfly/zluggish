import { defineConfig } from 'cf/config';

export default defineConfig({
  worker: {
    name: 'zluggish-docs',
    compatibilityDate: '2026-11-18',
    workersDev: true,
    previewUrls: true,
    domains: [{ hostname: 'docs.zluggish.com', production: true, previews: false }],
    observability: {
      enabled: true,
      headSamplingRate: 1,
      logs: {
        enabled: true,
        invocationLogs: true,
        headSamplingRate: 1,
        persist: true,
      },
      traces: {
        enabled: true,
        headSamplingRate: 1,
      },
      issues: {
        enabled: true,
      },
    },
    assets: {
      htmlHandling: 'auto-trailing-slash',
      notFoundHandling: '404-page',
    },
  },
});
