import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from './generated';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private _connected = false;
  private _isReconnecting = false;

  /** true se a conexão real foi estabelecida; false se estamos em fallback de mock. */
  get isConnected(): boolean {
    if (!this._connected && process.env['DATABASE_URL']) {
      this.ensureConnected().catch(() => {});
    }
    return this._connected;
  }

  set isConnected(value: boolean) {
    this._connected = value;
  }

  constructor() {
    super({
      log: ['warn', 'error'],
    });
  }

  async ensureConnected(): Promise<boolean> {
    if (this._connected) return true;
    if (!process.env['DATABASE_URL'] || this._isReconnecting) return this._connected;
    this._isReconnecting = true;
    try {
      await this.$connect();
      this._connected = true;
      this.logger.log('Prisma conectado com sucesso ao banco');
      return true;
    } catch (err: any) {
      this.logger.warn(
        `Prisma falhou ao conectar (${err?.message ?? err}). Modo offline ativado — services usarão mocks.`,
      );
      return false;
    } finally {
      this._isReconnecting = false;
    }
  }

  async onModuleInit() {
    if (!process.env['DATABASE_URL']) {
      this.logger.warn(
        'DATABASE_URL ausente — Prisma em modo offline. Services usarão mocks em memória.',
      );
      return;
    }
    await this.ensureConnected();

    // Auto-reconnect a cada 10s caso o banco de dados tenha sido reiniciado
    setInterval(() => {
      if (!this._connected && process.env['DATABASE_URL']) {
        this.ensureConnected().catch(() => {});
      }
    }, 10000);
  }

  async onModuleDestroy() {
    if (this._connected) {
      await this.$disconnect().catch(() => undefined);
    }
  }
}
