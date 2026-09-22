import axios from 'axios';
import { lookup } from 'dns/promises';
import { FacialService } from './facial.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('dns/promises', () => ({ lookup: jest.fn() }));

describe('FacialService image URL SSRF protection', () => {
  const axiosGet = axios.get as jest.Mock;
  const dnsLookup = lookup as jest.Mock;
  let service: FacialService;

  function buildService() {
    return new FacialService(
      { isConnected: false } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.R2_PUBLIC_URL = 'https://images.example.test/uploads';
    delete process.env.AWS_S3_BASE_URL;
    axiosGet.mockReset();
    dnsLookup.mockReset();
    dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    service = buildService();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.R2_PUBLIC_URL;
    delete process.env.AWS_S3_BASE_URL;
  });

  it.each([
    'http://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data',
    'https://attacker.example/x.jpg',
    'https://user:password@images.example.test/x.jpg',
    'https://[::1]/x.jpg',
  ])('rejects untrusted image URL without issuing HTTP request: %s', async (url) => {
    await expect((service as any).fetchPhotoAsBase64(url)).resolves.toBeNull();

    expect(axiosGet).not.toHaveBeenCalled();
  });

  it('preserves legacy data URLs without issuing HTTP request', async () => {
    await expect((service as any).toDataUrl('data:image/png;base64,cG5n')).resolves.toBe(
      'data:image/png;base64,cG5n',
    );

    expect(axiosGet).not.toHaveBeenCalled();
  });

  it('downloads only a configured HTTPS storage image with safe request limits', async () => {
    axiosGet.mockResolvedValue({
      data: Buffer.from('image-bytes'),
      headers: { 'content-type': 'image/jpeg' },
    });

    await expect(
      (service as any).fetchPhotoAsBase64('https://images.example.test/uploads/photo.jpg'),
    ).resolves.toBe(Buffer.from('image-bytes').toString('base64'));

    expect(axiosGet).toHaveBeenCalledWith(
      'https://images.example.test/uploads/photo.jpg',
      expect.objectContaining({
        responseType: 'arraybuffer',
        timeout: 15000,
        maxRedirects: 0,
        maxContentLength: 5 * 1024 * 1024,
        maxBodyLength: 5 * 1024 * 1024,
      }),
    );
  });

  it('rejects a trusted-origin response that is not an allowed image type', async () => {
    axiosGet.mockResolvedValue({
      data: Buffer.from('<html>not an image</html>'),
      headers: { 'content-type': 'text/html' },
    });

    await expect(
      (service as any).toDataUrl('https://images.example.test/uploads/not-an-image'),
    ).resolves.toBeNull();
  });

  it('rejects a configured hostname when DNS resolves it to a private address', async () => {
    dnsLookup.mockResolvedValue([{ address: '10.0.0.7', family: 4 }]);

    await expect(
      (service as any).fetchPhotoAsBase64('https://images.example.test/uploads/photo.jpg'),
    ).resolves.toBeNull();

    expect(axiosGet).not.toHaveBeenCalled();
  });

  it.each(['::ffff:7f00:1', '::7f00:1'])
  ('rejects IPv4 loopback encoded in an IPv6 DNS result: %s', async (address) => {
    dnsLookup.mockResolvedValue([{ address, family: 6 }]);

    await expect(
      (service as any).fetchPhotoAsBase64('https://images.example.test/uploads/photo.jpg'),
    ).resolves.toBeNull();

    expect(axiosGet).not.toHaveBeenCalled();
  });
});
