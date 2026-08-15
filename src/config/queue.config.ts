export const queueConfig = () => ({
  redis: {
    host: process.env.REDIS_HOST === 'localhost' || !process.env.REDIS_HOST
      ? '127.0.0.1'
      : process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    useMemory: process.env.USE_MEMORY_SESSION === 'true',
  },
  bullmq: {
    prefix: process.env.BULLMQ_PREFIX || 'erp',
  },
});
