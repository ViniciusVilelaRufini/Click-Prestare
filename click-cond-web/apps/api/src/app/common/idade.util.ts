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
