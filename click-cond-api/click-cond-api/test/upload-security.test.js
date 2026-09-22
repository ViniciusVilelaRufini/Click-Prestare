const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

function withAwsMock(run) {
  const uploads = [];
  const signed = [];
  const aws = {
    config: { update() {} },
    S3: function S3() {
      return {
        upload(params, callback) {
          uploads.push(params);
          callback(null, { Location: 'https://bucket.example/public/object', key: params.Key });
        },
        getSignedUrl(operation, params, callback) {
          signed.push({ operation, params });
          callback(null, 'https://signed-upload.example');
        },
      };
    },
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'aws-sdk') return aws;
    if (request === 'dotenv') return { config() {} };
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return run({ uploads, signed });
  } finally {
    Module._load = originalLoad;
  }
}

function withUploadEnvironment(run) {
  const original = { ...process.env };
  Object.assign(process.env, {
    AWS_S3_BUCKET_NAME: 'private-uploads',
    AWS_S3_BASE_URL: 'https://bucket.example/',
    AWS_ACCESS_KEY: 'test-key',
    AWS_SECRET_KEY: 'test-secret',
    AWS_S3_BUCKET_REGION: 'us-east-1',
    AWS_S3_API_KEY: 'test-key',
    AWS_S3_API_SECRET: 'test-secret',
  });
  try {
    return run();
  } finally {
    process.env = original;
  }
}

test('legacy saveToAWS rejects SVG bytes disguised as JPEG before S3 upload', async () => {
  await withUploadEnvironment(async () => withAwsMock(async ({ uploads }) => {
    const modulePath = require.resolve('../src/utils/saveToAWS');
    delete require.cache[modulePath];
    const saveToAWS = require(modulePath);
    const disguisedSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');

    assert.throws(
      () => saveToAWS(`data:image/jpeg;base64,${disguisedSvg}`, 'condominios/1', 'foto'),
      /INVALID_FILE_SIGNATURE/,
    );
    assert.equal(uploads.length, 0);
  }));
});

test('legacy storage disables direct signed uploads because they bypass server validation', async () => {
  await withUploadEnvironment(async () => withAwsMock(async ({ signed }) => {
    const modulePath = require.resolve('../src/libs/fileStorage');
    delete require.cache[modulePath];
    const fileStorage = require(modulePath);

    await assert.rejects(() => fileStorage.createSignedUrl('jpeg'), /DIRECT_UPLOAD_DISABLED/);

    assert.equal(signed.length, 0);
  }));
});
