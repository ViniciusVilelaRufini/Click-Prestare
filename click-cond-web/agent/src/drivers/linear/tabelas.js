'use strict';

/**
 * agent/src/drivers/linear/tabelas.js — tabelas do protocolo do Módulo
 * Guarita (Nice / Linear-HCS, MG3000) usadas pelo codec e pelo leitor de
 * fluxo. Só números: tamanhos de frame, tipos de dispositivo, marca e cor.
 *
 * Construído a partir da documentação do protocolo, NÃO validado em aparelho.
 */

// <tipo_disp> que a integração grava/lê: 1 RF (controle), 2 TA (TAG ativo),
// 3 CT (cartão), 6 TP (TAG passivo). 5 (biometria) e 7 (senha) ficam fora.
const TIPOS_DISPOSITIVO = Object.freeze([1, 2, 3, 6]);
const SIGLA_POR_TIPO = Object.freeze({ 1: 'RF', 2: 'TA', 3: 'CT', 6: 'TP' });

// Quantos bytes de parâmetro (entre o byte de comando e o checksum) cada
// comando da LISTA BRANCA leva no envio. Comando fora daqui não é montado.
const PARAMETROS_DO_ENVIO = Object.freeze({
  3: 0, // ler identificação (rótulos)
  6: 1, // quantidade de eventos <marca>
  7: 0, // quantidade de dispositivos
  12: 0, // ler relógio
  13: 4, // acionar saída <tipo> <num> <saida> <gera_evt> (sem resposta)
  17: 1, // ler eventos, progressivo <marca>
  29: 0, // atualizar receptores
  38: 0, // versão do Guarita
  43: 0, // interromper progressivo (sem resposta)
  61: 2, // versão do receptor <tipo> <num>
  67: 40, // <opcao> + frame de dispositivo (39)
  70: 0, // ler dispositivos, progressivo
});

// Tamanho TOTAL (0x00 + comando + dados + cs) do que o driver recebe.
// null = depende do conteúdo (67 pela opção; 33 pacote sem contador; 58 pelo
// tamanho do template embutido).
const TAMANHO_RECEBIDO = Object.freeze({
  3: 43,
  4: 20,
  6: 6,
  7: 5,
  12: 9,
  17: 20,
  25: 16,
  29: 4,
  32: 11,
  33: null,
  38: 8,
  40: 22,
  42: 11,
  46: 10,
  58: null,
  61: 10,
  67: null,
  70: 42,
  90: 13,
  100: 38,
  102: 16,
});

// Comandos que o Guarita manda sem pergunta (envio automático).
const ESPONTANEOS = Object.freeze([4, 25, 32, 33, 40, 42, 46, 58, 90, 100, 102]);

// Comandos que não têm resposta.
const SEM_RESPOSTA = Object.freeze([13, 43]);

// Pacote do comando 33: no máximo 67 eventos de 16 bytes.
const MAX_EVENTOS_PACOTE = 67;

// Tabela de marca (byte 31 do frame de dispositivo).
const MARCAS = Object.freeze({
  AUDI: 0x00, BMW: 0x01, CHEVROLET: 0x02, CHRYSLER: 0x03, CITROEN: 0x04, FERRARI: 0x05, FIAT: 0x06,
  FORD: 0x07, GM: 0x08, HONDA: 0x09, HYUNDAI: 0x0a, IMPORTADO: 0x0b, JAGUAR: 0x0c, JEEP: 0x0d, KIA: 0x0e,
  LAMBORGHINI: 0x0f, 'LAND ROVER': 0x10, MAZDA: 0x11, MERCEDES: 0x12, MITSUBISHI: 0x13, MOTO: 0x14,
  NISSAN: 0x15, VEICULO: 0x16, PEUGEOT: 0x17, PORSCHE: 0x18, RENAULT: 0x19, SUBARU: 0x1a, SUZUKI: 0x1b,
  TOYOTA: 0x1c, VOLKSWAGEN: 0x1d, VOLVO: 0x1e, 'SEM VEICULO': 0x1f,
});

// Tabela de cor (byte 32 do frame de dispositivo).
const CORES = Object.freeze({
  AMARELO: 0x00, AZUL: 0x01, BEGE: 0x02, BRANCO: 0x03, CINZA: 0x04, DOURADO: 0x05, FANTASIA: 0x06,
  GRENA: 0x07, LARANJA: 0x08, MARROM: 0x09, PRATA: 0x0a, PRETO: 0x0b, ROSA: 0x0c, ROXO: 0x0d,
  VERDE: 0x0e, VERMELHO: 0x0f,
});

module.exports = {
  TIPOS_DISPOSITIVO,
  SIGLA_POR_TIPO,
  PARAMETROS_DO_ENVIO,
  TAMANHO_RECEBIDO,
  ESPONTANEOS,
  SEM_RESPOSTA,
  MAX_EVENTOS_PACOTE,
  MARCAS,
  CORES,
};
