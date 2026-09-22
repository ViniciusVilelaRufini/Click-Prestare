require('dotenv').config();

/**
 * Direct browser-to-S3 uploads cannot be validated for MIME, byte limit and
 * magic bytes by this service. Keep uploads on the authenticated API path
 * (`utils/saveToAWS`) until an explicitly scoped multipart flow exists.
 */
exports.createSignedUrl = async function createSignedUrl() {
  throw new Error('DIRECT_UPLOAD_DISABLED');
};
