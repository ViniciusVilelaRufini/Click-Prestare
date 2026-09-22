const AWS = require('aws-sdk');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const UPLOAD_TYPES = {
  'image/jpeg': { extension: 'jpg', maxBytes: MAX_IMAGE_BYTES },
  'image/png': { extension: 'png', maxBytes: MAX_IMAGE_BYTES },
  'image/webp': { extension: 'webp', maxBytes: MAX_IMAGE_BYTES },
  'application/pdf': { extension: 'pdf', maxBytes: MAX_PDF_BYTES },
};

function invalid(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isStrictBase64(value) {
  if (!value || value.length % 4 !== 0) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const contentLength = value.length - padding;
  if ((padding === 1 && contentLength % 4 !== 3) || (padding === 2 && contentLength % 4 !== 2)) return false;

  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) || code === 43 || code === 47)) return false;
  }
  return true;
}

function hasExpectedSignature(contentType, buffer) {
  if (contentType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === 'image/webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

function parseDataUrl(dataUrl) {
  const separator = typeof dataUrl === 'string' ? dataUrl.indexOf(',') : -1;
  const header = separator >= 0 ? dataUrl.slice(0, separator) : '';
  const match = /^data:([^;,]+);base64$/i.exec(header);
  if (!match) throw invalid('INVALID_DATA_URL');

  const contentType = match[1].toLowerCase();
  const policy = UPLOAD_TYPES[contentType];
  if (!policy) throw invalid('TYPE_NOT_ALLOWED');

  const raw = dataUrl.slice(separator + 1);
  const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
  const decodedLength = (raw.length / 4) * 3 - padding;
  if (decodedLength > policy.maxBytes) throw invalid('FILE_TOO_LARGE');
  if (!isStrictBase64(raw)) throw invalid('INVALID_BASE64');

  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length || buffer.length > policy.maxBytes) throw invalid('FILE_TOO_LARGE');
  if (!hasExpectedSignature(contentType, buffer)) throw invalid('INVALID_FILE_SIGNATURE');

  return { buffer, contentType, extension: policy.extension };
}

function safeSegment(value, fallback) {
  return String(value || fallback).replace(/[^a-z0-9_\-/]/gi, '').replace(/\/+/g, '/').replace(/^\/|\/$/g, '').slice(0, 100) || fallback;
}

function isExistingStorageReference(value) {
  if (typeof value !== 'string' || !value || value.startsWith('data:') || /\s/.test(value)) return false;
  if (/^https?:\/\//i.test(value)) {
    try {
      return Boolean(new URL(value).hostname);
    } catch {
      return false;
    }
  }

  // Chaves opacas legadas (por exemplo, dev/condominios/1/foto.jpg).
  return /^[a-z0-9][a-z0-9._\-/]*$/i.test(value) &&
    value.includes('/') && !value.split('/').includes('..');
}

/** Uploads a validated data URL and returns an opaque object key, never a public URL. */
module.exports = (dataUrl, folder, name, options = {}) => {
  // Somente fluxos de edi\u00e7\u00e3o podem reenviar uma refer\u00eancia que j\u00e1 estava
  // persistida. Novos uploads continuam obrigatoriamente sendo data URLs.
  if (options.existing === true && isExistingStorageReference(dataUrl)) {
    return { key: dataUrl, name: dataUrl, url: dataUrl };
  }
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw invalid('NEW_UPLOAD_MUST_BE_DATA_URL');
  }

  const {
    AWS_S3_BUCKET_NAME: bucket,
    AWS_ACCESS_KEY: accessKeyId,
    AWS_SECRET_KEY: secretAccessKey,
    AWS_S3_BUCKET_REGION: region,
  } = process.env;

  if (!bucket || !accessKeyId || !secretAccessKey || !region) return false;
  const { buffer, contentType, extension } = parseDataUrl(dataUrl);

  AWS.config.update({ region, credentials: { accessKeyId, secretAccessKey } });
  const key = `dev/${safeSegment(folder, 'uploads')}/${safeSegment(name, 'arquivo')}-${Date.now()}.${extension}`;
  const s3 = new AWS.S3();

  return new Promise((resolve, reject) => {
    s3.upload({ Bucket: bucket, Body: buffer, Key: key, ContentType: contentType }, (err) => {
      if (err) reject(err);
      else resolve({ key, name: key, url: key });
    });
  });
};
