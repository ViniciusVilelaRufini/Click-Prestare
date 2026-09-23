import { BadRequestException } from '@nestjs/common';

/**
 * Converte diferentes formatos de data (Date, YYYY-MM-DD, DD/MM/YYYY) para Date segura.
 */
export function parseDataGenerica(data: Date | string | null | undefined): Date | null {
  if (!data) return null;
  if (data instanceof Date) return isNaN(data.getTime()) ? null : data;
  const str = String(data).trim();
  if (!str) return null;

  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [d, m, y] = str.split('/').map(Number);
    const parsed = new Date(y, m - 1, d);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  // YYYY-MM-DD ou ISO
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Calcula a idade completa em anos com base na data de nascimento.
 */
export function calcularIdade(dataNascimento: Date | string): number {
  const d = parseDataGenerica(dataNascimento);
  if (!d) return 0;

  const hoje = new Date();
  let idade = hoje.getFullYear() - d.getFullYear();
  const m = hoje.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < d.getDate())) {
    idade--;
  }
  return Math.max(0, idade);
}

/**
 * Valida se o titular é maior de 18 anos.
 * Lança BadRequestException se menor de 18 ou se a data for ausente/inválida.
 */
export function validarMaioridade(
  dataNascimento: Date | string | null | undefined,
  contexto = 'cadastro',
): void {
  const d = parseDataGenerica(dataNascimento);
  if (!d) {
    throw new BadRequestException(
      `A data de nascimento é obrigatória para ${contexto} conforme a Cláusula 8.3 do contrato e a LGPD.`,
    );
  }

  const idade = calcularIdade(d);
  if (idade < 18) {
    throw new BadRequestException(
      `Operação não permitida para menores de 18 anos (${idade} anos informados). A Cláusula 8.3 do contrato e a LGPD vedam contas e perfis biométricos de menores.`,
    );
  }
}

/**
 * Marca gravada em `Moradores.extra2` quando o responsável aceita, no app, o
 * termo de consentimento de biometria do menor (LGPD Art. 14).
 */
export const MARCA_TERMO_RESPONSAVEL = 'CONSENTIMENTO_BIOMETRIA_ACEITO_EM';

export function temTermoResponsavel(extra2: string | null | undefined): boolean {
  return !!extra2 && String(extra2).includes(MARCA_TERMO_RESPONSAVEL);
}

/**
 * Foto/biometria facial. Decisão do produto (23/09/2026): menor de 18 anos
 * pode, desde que o responsável tenha aceito o termo de consentimento (LGPD
 * Art. 14). A data de nascimento continua obrigatória — sem ela não há como
 * saber se o termo é exigido. Conta/login de menor segue vedada
 * (validarMaioridade).
 */
export function validarBiometria(
  dataNascimento: Date | string | null | undefined,
  termoResponsavel: boolean,
  contexto = 'cadastro de biometria facial',
): void {
  const d = parseDataGenerica(dataNascimento);
  if (!d) {
    throw new BadRequestException(
      `A data de nascimento é obrigatória para ${contexto} (LGPD).`,
    );
  }
  if (calcularIdade(d) < 18 && !termoResponsavel) {
    throw new BadRequestException(
      'Foto e biometria de menor de 18 anos exigem o termo de consentimento do responsável (LGPD Art. 14).',
    );
  }
}
