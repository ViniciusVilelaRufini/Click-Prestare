'use strict';

/**
 * agent/src/lib/multipart.js — multipart/form-data usado no cadastro de
 * rosto do Hikvision.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMultipart } = require('../src/lib/multipart');

test('buildMultipart(): contentType traz um boundary "----clickbnd" + 16 hex', () => {
  const { contentType } = buildMultipart([{ name: 'meta', json: { a: 1 } }]);
  assert.match(contentType, /^multipart\/form-data; boundary=----clickbnd[0-9a-f]{16}$/);
});

test('buildMultipart(): parte json vem com Content-Type application/json e o corpo serializado', () => {
  const { body, contentType } = buildMultipart([{ name: 'meta', json: { a: 1, b: 'x' } }]);
  const boundary = contentType.match(/boundary=(.+)$/)[1];
  const text = body.toString('utf8');

  assert.ok(text.includes(`--${boundary}\r\n`));
  assert.ok(text.includes('Content-Disposition: form-data; name="meta"\r\n'));
  assert.ok(text.includes('Content-Type: application/json\r\n\r\n'));
  assert.ok(text.includes(JSON.stringify({ a: 1, b: 'x' })));
  assert.ok(text.trimEnd().endsWith(`--${boundary}--`));
});

test('buildMultipart(): parte jpeg vem com filename, Content-Type image/jpeg e os bytes crus', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02]);
  const { body, contentType } = buildMultipart([
    { name: 'face', jpeg, filename: 'rosto.jpg' },
  ]);
  const boundary = contentType.match(/boundary=(.+)$/)[1];

  assert.ok(
    body.includes(
      Buffer.from(
        `Content-Disposition: form-data; name="face"; filename="rosto.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
    ),
  );
  assert.ok(body.includes(jpeg)); // bytes binários preservados sem alteração
  assert.ok(body.toString('latin1').trimEnd().endsWith(`--${boundary}--`));
});

test('buildMultipart(): sem filename, usa "face.jpg" como default', () => {
  const { body } = buildMultipart([{ name: 'face', jpeg: Buffer.from([1, 2, 3]) }]);
  assert.ok(body.toString('latin1').includes('filename="face.jpg"'));
});

test('buildMultipart(): múltiplas partes ficam separadas, cada uma com seu boundary', () => {
  const { body, contentType } = buildMultipart([
    { name: 'meta', json: { ok: true } },
    { name: 'face', jpeg: Buffer.from([9, 9]), filename: 'f.jpg' },
  ]);
  const boundary = contentType.match(/boundary=(.+)$/)[1];
  const text = body.toString('latin1');
  const ocorrencias = text.split(`--${boundary}\r\n`).length - 1;
  assert.equal(ocorrencias, 2);
});
