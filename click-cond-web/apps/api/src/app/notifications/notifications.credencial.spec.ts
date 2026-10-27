import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: { cert: jest.fn((c: any) => ({ cert: c })) },
  messaging: jest.fn(),
}));

import * as admin from 'firebase-admin';
import { NotificationsService } from './notifications.service';

/**
 * A pasta assets/ é servida publicamente na raiz (main.ts). A credencial do
 * Firebase nunca pode ser lida de lá: só de FIREBASE_SERVICE_ACCOUNT_JSON ou de
 * FIREBASE_SERVICE_ACCOUNT_PATH fora da pasta servida.
 */
describe('NotificationsService — credencial do Firebase fora da pasta pública', () => {
  const OLD = { ...process.env };
  const pastaAssets = path.resolve(__dirname, 'assets');
  let tmp: string | null = null;

  beforeEach(() => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    (admin.initializeApp as jest.Mock).mockClear();
    (admin.credential.cert as jest.Mock).mockClear();
  });

  afterEach(() => {
    process.env = { ...OLD };
    fs.rmSync(pastaAssets, { recursive: true, force: true });
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it('não usa mais assets/firebase-service-account.json (fica desligado sem env)', () => {
    fs.mkdirSync(pastaAssets, { recursive: true });
    fs.writeFileSync(path.join(pastaAssets, 'firebase-service-account.json'), '{"project_id":"x"}');
    const svc: any = new NotificationsService({} as any);
    svc.onModuleInit();
    expect(admin.initializeApp).not.toHaveBeenCalled();
    expect(svc.enabled).toBe(false);
  });

  it('recusa FIREBASE_SERVICE_ACCOUNT_PATH apontando para dentro de assets/', () => {
    fs.mkdirSync(pastaAssets, { recursive: true });
    const arq = path.join(pastaAssets, 'sa.json');
    fs.writeFileSync(arq, '{"project_id":"x"}');
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = arq;
    const svc: any = new NotificationsService({} as any);
    svc.onModuleInit();
    expect(admin.initializeApp).not.toHaveBeenCalled();
    expect(svc.enabled).toBe(false);
  });

  it('carrega de FIREBASE_SERVICE_ACCOUNT_PATH fora da pasta servida', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fcm-'));
    const arq = path.join(tmp, 'sa.json');
    fs.writeFileSync(arq, '{"project_id":"x"}');
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = arq;
    const svc: any = new NotificationsService({} as any);
    svc.onModuleInit();
    expect(admin.credential.cert).toHaveBeenCalledWith(arq);
    expect(admin.initializeApp).toHaveBeenCalledTimes(1);
    expect(svc.enabled).toBe(true);
  });
});
