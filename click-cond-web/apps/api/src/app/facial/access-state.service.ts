import { Injectable, Logger } from '@nestjs/common';

/**
 * Estado de acesso em memória para anti-passback e cooldown.
 *
 * Cooldown: mesma credencial no mesmo device em janela curta (default 15s)
 * é tratada como duplicata. Cobre dois cenários comuns:
 *   - Leitor com defeito disparando 100 eventos por segundo
 *   - Pessoa que apresenta o crachá duas vezes por reflexo
 *
 * Anti-passback (APB): pessoa marcada como "dentro" no condomínio não pode
 * entrar de novo até ter uma saída registrada (e vice-versa). Cobre:
 *   - Crachá clonado tentando entrar enquanto o original está dentro
 *   - Tentativa de "passar a tag pra trás" para outra pessoa
 *
 * APB é POR CONDOMÍNIO (não por leitor), com modo configurável via env:
 *   - "off": só loga, não bloqueia
 *   - "soft" (default): permite mas registra o evento como suspeito —
 *     auditável sem risco de falso bloqueio
 *   - "hard": bloqueia e nega o acesso
 *
 * O estado vive em memória, mas quem consome (FacialService) SEMEIA a
 * presença a partir do último evento em Acessos_Facial quando não há estado
 * (pós-restart) — o restart do backend não "esquece" quem está dentro.
 */
@Injectable()
export class AccessStateService {
  private readonly logger = new Logger(AccessStateService.name);
  private readonly cooldownMs = Number(process.env.ACCESS_COOLDOWN_MS ?? 15_000);
  private readonly apbMode = (process.env.ANTI_PASSBACK_MODE ?? 'soft') as 'off' | 'soft' | 'hard';

  /** Map<deviceId+credencial, ultimoTimestamp> — para cooldown. */
  private readonly lastSeen = new Map<string, number>();

  /** Map<condominioId+tipoPessoa+idPessoa, 'dentro'|'fora'> — para APB. */
  private readonly presenca = new Map<string, 'dentro' | 'fora'>();

  /**
   * Retorna `true` se este evento deve ser ignorado por estar dentro
   * da janela de cooldown (evento duplicado do mesmo leitor para a mesma
   * credencial em poucos segundos).
   *
   * O sentido (entrada/saida) faz parte da chave: bater entrada e logo em
   * seguida bater saída no mesmo leitor é fluxo legítimo, não duplicata.
   */
  shouldDebounce(idDevice: number, credencial: string, evento = ''): boolean {
    if (!credencial) return false;
    const key = `${idDevice}:${credencial}:${evento}`;
    const now = Date.now();
    const last = this.lastSeen.get(key);
    if (last && now - last < this.cooldownMs) {
      this.logger.debug(
        `Debounce: ${credencial} no device ${idDevice} já visto há ${now - last}ms`,
      );
      return true;
    }
    this.lastSeen.set(key, now);
    // Limpeza preguiçosa: a cada gravação tenta podar entradas antigas.
    if (this.lastSeen.size > 5000) this.podar();
    return false;
  }

  /**
   * Verifica e atualiza estado de presença antes do acesso.
   * - 'allow': pode passar
   * - 'allow_with_warning': passa, mas registrar como suspeito (modo soft)
   * - 'deny': bloqueia (modo hard)
   *
   * Apenas para moradores/visitantes/prestadores. Funcionários e leitores
   * "ambos" (sem direção clara) ficam fora do APB.
   */
  checkAntiPassback(
    idCondominio: number,
    tipoPessoa: string,
    idPessoa: number,
    evento: 'entrada' | 'saida' | string,
  ): 'allow' | 'allow_with_warning' | 'deny' {
    if (this.apbMode === 'off') {
      // Mesmo em "off", atualizamos o estado pra ter histórico — só não barra.
      this.atualizarPresenca(idCondominio, tipoPessoa, idPessoa, evento);
      return 'allow';
    }
    if (evento !== 'entrada' && evento !== 'saida') {
      return 'allow';
    }
    const key = `${idCondominio}:${tipoPessoa}:${idPessoa}`;
    const atual = this.presenca.get(key) ?? 'fora';

    const violacao =
      (evento === 'entrada' && atual === 'dentro') ||
      (evento === 'saida' && atual === 'fora');

    if (!violacao) {
      this.atualizarPresenca(idCondominio, tipoPessoa, idPessoa, evento);
      return 'allow';
    }

    this.logger.warn(
      `Anti-passback (${this.apbMode}): ${tipoPessoa} #${idPessoa} tentou ${evento} mas estava ${atual}`,
    );

    if (this.apbMode === 'hard') return 'deny';
    // soft: deixa passar mas marca como suspeito; atualiza estado mesmo assim
    this.atualizarPresenca(idCondominio, tipoPessoa, idPessoa, evento);
    return 'allow_with_warning';
  }

  /** Há estado de presença conhecido para esta pessoa? (falso pós-restart) */
  hasPresenca(idCondominio: number, tipoPessoa: string, idPessoa: number): boolean {
    return this.presenca.has(`${idCondominio}:${tipoPessoa}:${idPessoa}`);
  }

  /** Força estado (usado por trigger manual ou correção administrativa). */
  setPresenca(
    idCondominio: number,
    tipoPessoa: string,
    idPessoa: number,
    estado: 'dentro' | 'fora',
  ) {
    this.presenca.set(`${idCondominio}:${tipoPessoa}:${idPessoa}`, estado);
  }

  private atualizarPresenca(
    idCondominio: number,
    tipoPessoa: string,
    idPessoa: number,
    evento: string,
  ) {
    if (evento === 'entrada') {
      this.setPresenca(idCondominio, tipoPessoa, idPessoa, 'dentro');
    } else if (evento === 'saida') {
      this.setPresenca(idCondominio, tipoPessoa, idPessoa, 'fora');
    }
  }

  private podar() {
    const cutoff = Date.now() - this.cooldownMs * 4;
    for (const [k, t] of this.lastSeen) {
      if (t < cutoff) this.lastSeen.delete(k);
    }
  }
}
