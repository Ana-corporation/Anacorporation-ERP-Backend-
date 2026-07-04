export const jwtConfig = () => ({
  secret: process.env.JWT_SECRET || 'change-me-in-production',
  accessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
  refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
});
