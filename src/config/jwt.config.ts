export const jwtConfig = () => ({
  secret: process.env.JWT_SECRET || 'change-me-in-production',
  // Dev-friendly default; override with JWT_ACCESS_EXPIRATION in .env
  accessExpiration: process.env.JWT_ACCESS_EXPIRATION || '8h',
  refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
});
