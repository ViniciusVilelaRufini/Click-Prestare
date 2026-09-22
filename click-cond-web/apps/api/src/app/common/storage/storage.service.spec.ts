jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest.fn((input) => input),
  DeleteObjectCommand: jest.fn((input) => input),
}));

import { BadRequestException } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { JSON_BODY_LIMIT_BYTES, MAX_PDF_BYTES } from './upload-limits';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  const originalEnv = { ...process.env };
  const send = jest.fn();
  let service: StorageService;

  beforeEach(() => {
    process.env.R2_ACCESS_KEY_ID = 'test-access-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.R2_ENDPOINT = 'https://account.r2.cloudflarestorage.com';
    process.env.R2_BUCKET = 'private-uploads';
    process.env.R2_PUBLIC_URL = 'https://storage.example.test/uploads';
    send.mockReset().mockResolvedValue({});
    (S3Client as unknown as jest.Mock).mockImplementation(() => ({ send }));
    service = new StorageService();
  });

  afterAll(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it.each([
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:text/html;base64,PGgxPg==',
  ])('rejects unsupported upload MIME %s before sending it to storage', async (value) => {
    await expect(service.uploadDataUrl(value, 'moradores')).rejects.toBeInstanceOf(BadRequestException);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects malformed base64 before sending it to storage', async () => {
    await expect(
      service.uploadDataUrl('data:image/jpeg;base64,not valid base64', 'moradores'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects images larger than 5 MiB before sending them to storage', async () => {
    const oversizedImage = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64');

    await expect(
      service.uploadDataUrl(`data:image/png;base64,${oversizedImage}`, 'moradores'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects PDFs larger than 10 MiB before sending them to storage', async () => {
    const oversizedPdf = Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64');

    await expect(
      service.uploadDataUrl(`data:application/pdf;base64,${oversizedPdf}`, 'documentos'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(send).not.toHaveBeenCalled();
  });

  it('uploads a valid jpeg without a public ACL', async () => {
    const result = await service.uploadDataUrl('data:image/jpeg;base64,/9j/AA==', 'moradores');

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        ACL: undefined,
        Bucket: 'private-uploads',
        ContentType: 'image/jpeg',
      }),
    );
    expect(result).toMatch(/^moradores\//);
    expect(result).not.toContain('https://storage.example.test');
  });

  it.each([
    ['image/jpeg', Buffer.from('<html>not an image</html>')],
    ['image/png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['image/webp', Buffer.from('%PDF-1.7')],
    ['application/pdf', Buffer.from('<script>alert(1)</script>')],
  ])('rejects bytes that do not match declared MIME %s', async (mime, content) => {
    await expect(
      service.uploadDataUrl(`data:${mime};base64,${content.toString('base64')}`, 'moradores'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(send).not.toHaveBeenCalled();
  });

  it('sets a JSON limit that can carry the maximum supported PDF data URL', () => {
    const pdf = Buffer.alloc(MAX_PDF_BYTES);
    Buffer.from('%PDF-').copy(pdf);
    const body = JSON.stringify({ doc: `data:application/pdf;base64,${pdf.toString('base64')}` });

    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(JSON_BODY_LIMIT_BYTES);
  });

  it('recognizes configured legacy public URLs without trusting other origins', () => {
    expect(service.isTrustedPublicUrl('https://storage.example.test/uploads/moradores/foto.jpg')).toBe(true);
    expect(service.isTrustedPublicUrl('https://storage.example.test/other/foto.jpg')).toBe(false);
    expect(service.isTrustedPublicUrl('https://attacker.example.test/uploads/foto.jpg')).toBe(false);
  });
});
