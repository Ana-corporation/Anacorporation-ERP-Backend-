import { appConfig } from './app.config';
import { databaseConfig } from './database.config';
import { jwtConfig } from './jwt.config';
import { oauthConfig } from './oauth.config';
import { mailConfig } from './mail.config';
import { storageConfig } from './storage.config';
import { queueConfig } from './queue.config';
import { authSecurityConfig } from './auth-security.config';

export default () => {
  const queue = queueConfig();
  return {
    app: appConfig(),
    database: databaseConfig(),
    jwt: jwtConfig(),
    oauth: oauthConfig(),
    mail: mailConfig(),
    gcs: storageConfig(),
    redis: queue.redis,
    bullmq: queue.bullmq,
    auth: authSecurityConfig(),
  };
};
