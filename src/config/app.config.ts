export const appConfig = () => ({
  name: process.env.APP_NAME || 'ERP Backend',
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'api/v1',
});
