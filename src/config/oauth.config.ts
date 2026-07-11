export const oauthConfig = () => ({
  google: {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
  },
  microsoft: {
    clientId: process.env.MICROSOFT_OAUTH_CLIENT_ID ?? '',
    clientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET ?? '',
    tenantId: process.env.MICROSOFT_OAUTH_TENANT_ID ?? 'common',
  },
});
