/** Redis is off unless REDIS_HOST is set. Sessions stay in-memory until then. */
export const queueConfig = () => ({
  redis: {
    host: process.env.REDIS_HOST === 'localhost' ? '127.0.0.1' : process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    useMemory: !process.env.REDIS_HOST,
  },
  bullmq: {
    prefix: process.env.BULLMQ_PREFIX || 'erp',
  },
});
