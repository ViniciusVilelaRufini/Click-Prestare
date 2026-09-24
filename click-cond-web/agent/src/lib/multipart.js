'use strict';

const crypto = require('crypto');

/**
 * Monta um corpo multipart/form-data. parts = [{ name, json } | { name, jpeg, filename }].
 * Devolve { body: Buffer, contentType }. Usado no cadastro de rosto do Hikvision.
 */
function buildMultipart(parts) {
  const boundary = '----clickbnd' + crypto.randomBytes(8).toString('hex');
  const chunks = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (p.json !== undefined) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"\r\nContent-Type: application/json\r\n\r\n`,
        ),
      );
      chunks.push(Buffer.from(JSON.stringify(p.json)));
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename || 'face.jpg'}"\r\nContent-Type: image/jpeg\r\n\r\n`,
        ),
      );
      chunks.push(p.jpeg);
    }
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

module.exports = { buildMultipart };
