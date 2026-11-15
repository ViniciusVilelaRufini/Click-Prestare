import { criarBancoFalso } from './guarita-banco-falso.testutil';
import { GuaritaPortoesService } from './guarita-portoes.service';
import { GuaritaAgenteService } from './guarita-agente.service';
import { GuaritaController } from './guarita.controller';
import { GuaritaImportacaoService } from './guarita-importacao.service';
import { GuaritaOperacoesService } from './guarita-operacoes.service';
import { GuaritaEventosService } from './guarita-eventos.service';
import { GuaritaCapturaService } from './guarita-captura.service';

/** SÓ PARA TESTES: o console do Guarita montado sobre o banco falso, com ponte e auditoria falsas. */
/** `fn` = jest.fn (passado pelo spec: este arquivo não importa nada do Jest, para não entrar no bundle). */
export function montarConsole(fn: (impl?: (...a: any[]) => any) => any, opts: { agenteOnline?: boolean } = {}) {
  const db = criarBancoFalso();
  db.semear('facial_Devices', [
    { id: 10, id_condominio: 7, nome: 'Guarita', tipo: 'guarita', fabricante: 'linear', ativo: 1 },
    { id: 20, id_condominio: 8, nome: 'Guarita do 8', tipo: 'guarita', fabricante: 'linear', ativo: 1 },
  ]);
  const bridge: any = {
    isOnline: fn(() => opts.agenteOnline ?? true),
    enqueue: fn(async () => ({ ok: true })),
  };
  const auditoria: any = { registrar: fn(async () => undefined) };
  const agente = new GuaritaAgenteService(db as any, {} as any);
  const operacoes = new GuaritaOperacoesService(db as any);
  const portoes = new GuaritaPortoesService(db as any, bridge, auditoria, agente);
  const captura = new GuaritaCapturaService(db as any, agente, operacoes);
  const ctrl = new GuaritaController(
    new GuaritaImportacaoService(db as any),
    operacoes,
    new GuaritaEventosService(db as any),
    portoes,
    captura,
  );
  return { db, bridge, auditoria, agente, operacoes, portoes, captura, ctrl };
}

