export const storageConfig = () => ({
  projectId: process.env.GCS_PROJECT_ID,
  bucket: process.env.GCS_BUCKET,
  keyFilePath: process.env.GCS_KEY_FILE_PATH,
  publicBaseUrl: process.env.GCS_PUBLIC_BASE_URL,
});
