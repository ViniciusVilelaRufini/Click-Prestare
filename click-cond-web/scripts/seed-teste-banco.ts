/**
 * Seed massivo: cria condomínio "Teste Banco" e popula com dados realistas
 * em todas as áreas do app. Vinculado ao síndico id=138.
 *
 * Uso: npx tsx scripts/seed-teste-banco.ts
 *
 * Todos os registros são prefixados com [TESTE] no nome/título para fácil
 * identificação e limpeza posterior.
 */
import { PrismaClient } from '../apps/api/src/app/prisma/generated';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

// Carrega .env manualmente.
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const prisma = new PrismaClient();

const SINDICO_USER_ID = 138;
const COND_NOME = 'Teste Banco';

// ------- POOLS DE DADOS -------
const PRIMEIROS_NOMES = [
  'Ana', 'Bruno', 'Carlos', 'Daniela', 'Eduardo', 'Fernanda', 'Gabriel', 'Helena',
  'Igor', 'Juliana', 'Kauã', 'Larissa', 'Mariana', 'Nathan', 'Otávio', 'Patricia',
  'Quitéria', 'Rafael', 'Sofia', 'Thiago', 'Ursula', 'Vitor', 'Wesley', 'Xavier',
  'Yara', 'Zélia', 'André', 'Beatriz', 'Caio', 'Débora', 'Enzo', 'Flávia',
  'Gustavo', 'Heloísa', 'Ivan', 'Joana', 'Karina', 'Lucas', 'Miguel', 'Nicole',
];

const SOBRENOMES = [
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Rodrigues',
  'Almeida', 'Nascimento', 'Carvalho', 'Gomes', 'Martins', 'Araújo', 'Ribeiro',
  'Alves', 'Monteiro', 'Mendes', 'Barros', 'Freitas', 'Cardoso', 'Ramos',
];

const CATEGORIAS_PRESTADOR = [
  'Hidráulica', 'Elétrica', 'Pintura', 'Limpeza', 'Marcenaria', 'Vidraçaria',
  'Manutenção elevadores', 'Jardinagem', 'Pragas', 'Reformas',
];

const FUNCOES_FUNC = ['Porteiro Diurno', 'Porteiro Noturno', 'Faxineira', 'Zelador'];
const TURNOS = ['06:00 às 14:00', '14:00 às 22:00', '22:00 às 06:00'];

const AREAS_NOMES = [
  { nome: 'Salão de Festas', capacidade: 80, autorizacao: true },
  { nome: 'Salão Gourmet', capacidade: 40, autorizacao: true },
  { nome: 'Churrasqueira A', capacidade: 25, autorizacao: false },
  { nome: 'Churrasqueira B', capacidade: 25, autorizacao: false },
  { nome: 'Piscina', capacidade: 50, autorizacao: false },
  { nome: 'Sauna Seca', capacidade: 8, autorizacao: true },
  { nome: 'Sauna Úmida', capacidade: 8, autorizacao: true },
  { nome: 'Quadra Poliesportiva', capacidade: 20, autorizacao: false },
  { nome: 'Sala de Jogos', capacidade: 15, autorizacao: false },
  { nome: 'Espaço Coworking', capacidade: 10, autorizacao: false },
];

const CATEGORIAS_FIN_RECEITA = [
  'Taxa Condominial', 'Multas', 'Fundo de Reserva', 'Locação Salão', 'Outros',
];
const CATEGORIAS_FIN_DESPESA = [
  'Manutenção', 'Limpeza', 'Energia', 'Água', 'Segurança',
  'Jardinagem', 'Folha de Pagamento', 'Tributos', 'Material', 'Outros',
];

const STATUS_ENCOMENDA = ['Aguardando', 'Aguardando', 'Aguardando', 'Retirada', 'Retirada'];
const STATUS_OCORRENCIA = ['Pendente', 'Pendente', 'Ciente', 'Solucionado'];

const RECEBIDO_DE = ['Correios SEDEX', 'Mercado Livre', 'iFood', 'Amazon', 'Magazine Luiza', 'Shopee', 'Loggi'];

// ------- HELPERS -------
const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randCpf = () => String(randInt(10000000000, 99999999998));
const randTel = () => `1${randInt(0, 9)}9${randInt(10000000, 99999999)}`;
const randDate = (daysBack: number) => {
  const d = new Date();
  d.setDate(d.getDate() - randInt(0, daysBack));
  return d;
};
const futureDate = (daysFwd: number) => {
  const d = new Date();
  d.setDate(d.getDate() + randInt(1, daysFwd));
  return d;
};
const fullName = () => `[TESTE] ${rand(PRIMEIROS_NOMES)} ${rand(SOBRENOMES)}`;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function inLotes<T, R>(items: T[], lote: number, fn: (it: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (const c of chunk(items, lote)) {
    const r = await Promise.all(c.map(fn));
    out.push(...r);
  }
  return out;
}

// ------- MAIN -------
async function main() {
  const t0 = Date.now();
  console.log('🔌 Conectando ao banco...');

  // 1. Verifica síndico
  const sindico = await prisma.users.findUnique({ where: { id: SINDICO_USER_ID } });
  if (!sindico) {
    console.error(`❌ Síndico id=${SINDICO_USER_ID} não existe. Rode create-sindico.ts primeiro.`);
    process.exit(1);
  }

  // 2. Reutiliza condomínio "Teste Banco" se já existe (idempotente)
  let cond = await prisma.condominios.findFirst({ where: { nome: COND_NOME } });
  if (cond) {
    console.log(`♻️  Condomínio "${COND_NOME}" já existe (id=${cond.id}). Continuando seed sobre ele.`);
  } else {
    console.log(`🏢 Criando condomínio "${COND_NOME}"...`);
    cond = await prisma.condominios.create({
      data: {
        nome: COND_NOME,
        identificacao: '12345678/0001-90',
        subsindico_nome: '[TESTE] Subsíndico',
        num_blocos: 8,
        num_aptos: 240,
        moeda: 'BRL',
        ativo: 1,
        vencimento: futureDate(365),
      },
    });
    await prisma.sindicos_Condominios.create({
      data: { id_user: SINDICO_USER_ID, id_condominio: cond.id },
    });
  }
  const idCond = cond.id;
  console.log(`   → idCondominio = ${idCond}\n`);

  // 3. Categorias de ocorrência globais (cria se não tiver)
  const categoriasExistentes = await prisma.ocorrencias_Categorias.findMany();
  let categorias = categoriasExistentes;
  if (categorias.length === 0) {
    const padraoCats = ['Barulho', 'Vandalismo', 'Manutenção', 'Segurança', 'Lixo', 'Vazamento'];
    for (const nome of padraoCats) {
      await prisma.ocorrencias_Categorias.create({
        data: { nome, prioridade: randInt(1, 3) },
      });
    }
    categorias = await prisma.ocorrencias_Categorias.findMany();
  }

  // 4. Apartamentos (8 blocos × 30 aptos)
  console.log('🏠 Criando apartamentos...');
  const blocos = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const aptosData: { bloco: string; apto: string; fracao: string; id_condominio: number }[] = [];
  for (const b of blocos) {
    for (let andar = 1; andar <= 10; andar++) {
      for (let pos = 1; pos <= 3; pos++) {
        aptosData.push({
          bloco: b,
          apto: `${andar}0${pos}`,
          fracao: '0.00417',
          id_condominio: idCond,
        });
      }
    }
  }
  await prisma.apartamentos.createMany({ data: aptosData, skipDuplicates: true });
  const apartamentos = await prisma.apartamentos.findMany({
    where: { id_condominio: idCond },
  });
  console.log(`   → ${apartamentos.length} apartamentos\n`);

  // 5. Moradores (230 distribuídos nos primeiros 230 aptos)
  console.log('👥 Criando moradores (230)...');
  const senhaPadrao = await bcrypt.hash('123456', 10);
  const TIPOS = ['proprietario', 'inquilino', 'dependente'];

  const moradoresCriados: any[] = [];
  const aptosShuffled = [...apartamentos].sort(() => Math.random() - 0.5);

  for (let i = 0; i < 230; i++) {
    const apto = aptosShuffled[i % aptosShuffled.length];
    const tipo = TIPOS[Math.min(2, Math.floor(i / 80))]; // ~80 de cada
    const nome = fullName();
    const email = `morador.teste${i}@exemplo.com`;
    const cpf = randCpf();
    try {
      const user = await prisma.users.create({
        data: {
          name: nome,
          email,
          login: email,
          password: senhaPadrao,
          phone: randTel(),
          cpf,
          is_morador: 1,
          login_type: 'morador',
        },
      });
      await prisma.moradores.create({
        data: {
          nome,
          documento: cpf,
          email,
          telefone: randTel(),
          tipo,
          id_user: user.id,
          id_condominio: idCond,
          bloco: apto.bloco,
          apartamento: apto.apto,
        },
      });
      const venc = new Date();
      venc.setDate(venc.getDate() + 45);
      await prisma.apartamentos_Users.create({
        data: { id_apto: apto.id, id_user: user.id, tipo, vencimento: venc },
      });
      moradoresCriados.push({ user, apto, tipo });
    } catch (e: any) {
      // CPF / email duplicado raro — ignora e segue
      if (i % 50 === 0) console.log(`   …${i}`);
    }
  }
  console.log(`   → ${moradoresCriados.length} moradores criados\n`);

  // 6. Prestadores de serviço (50)
  console.log('🛠️  Prestadores (50)...');
  const prestadoresData = Array.from({ length: 50 }, () => ({
    nome: `[TESTE] ${rand(['Serviços', 'Empresa', 'Cia', 'Grupo'])} ${rand(SOBRENOMES)}`,
    telefone: randTel(),
    categorias: Array.from(new Set([rand(CATEGORIAS_PRESTADOR), rand(CATEGORIAS_PRESTADOR)])).join(';'),
    id_condominio: idCond,
  }));
  await prisma.prestadores_servico.createMany({ data: prestadoresData });
  console.log(`   → 50 prestadores\n`);

  // 7. Funcionários de portaria (15)
  console.log('👮 Funcionários de portaria (15)...');
  for (let i = 0; i < 15; i++) {
    const nome = fullName().replace('[TESTE] ', '[TESTE FUNC] ');
    const login = `func.teste${idCond}.${i}@portaria.local`;
    try {
      await prisma.funcionarios_Portaria.create({
        data: {
          nome,
          login,
          password: senhaPadrao,
          email: login,
          telefone: randTel(),
          turno: rand(TURNOS),
          ativo: 1,
          id_condominio: idCond,
        },
      });
    } catch {}
  }
  console.log(`   → ok\n`);

  // 8. Áreas sociais (10)
  console.log('🏛️  Áreas sociais (10)...');
  const areasIds: number[] = [];
  for (const a of AREAS_NOMES) {
    const horarios = JSON.stringify([
      { de: '08:00', ate: '12:00' },
      { de: '13:00', ate: '17:00' },
      { de: '18:00', ate: '22:00' },
    ]);
    const created = await prisma.areas_Sociais.create({
      data: {
        nome: `[TESTE] ${a.nome}`,
        capacidade: a.capacidade,
        precisa_agendar: 1,
        precisa_autorizacao: a.autorizacao ? 1 : 0,
        precisa_pagamento: 0,
        horarios,
        id_condominio: idCond,
      },
    });
    areasIds.push(created.id);
  }
  console.log(`   → ${areasIds.length} áreas\n`);

  // 9. Agendamentos de áreas (100)
  console.log('📅 Agendamentos áreas (100)...');
  const STATUS_AGEND = ['aprovado', 'aprovado', 'pendente', 'recusado'];
  let agendCount = 0;
  for (let i = 0; i < 100; i++) {
    const m = rand(moradoresCriados);
    if (!m) continue;
    const data = new Date();
    data.setDate(data.getDate() + randInt(-30, 60));
    const horas = randInt(8, 18);
    try {
      await prisma.areas_Sociais_Agendamentos.create({
        data: {
          id_area_social: rand(areasIds),
          id_user: m.user.id,
          id_apartamento: m.apto.id,
          data,
          hora_de: new Date(1970, 0, 1, horas, 0, 0),
          hora_ate: new Date(1970, 0, 1, horas + 4, 0, 0),
          status: rand(STATUS_AGEND),
        },
      });
      agendCount++;
    } catch {}
  }
  console.log(`   → ${agendCount} agendamentos\n`);

  // 10. Visitantes (300) — 100 ativos + 200 históricos
  console.log('🚪 Visitantes (300)...');
  let visCount = 0;
  for (let i = 0; i < 300; i++) {
    const apto = rand(apartamentos);
    const ativo = i < 100;
    const inicio = randDate(ativo ? 0 : 90);
    const termino = ativo ? null : new Date(inicio.getTime() + randInt(30, 600) * 60000);
    try {
      await prisma.visitantes.create({
        data: {
          nome: fullName(),
          doc_identificacao: randCpf(),
          data_hora_inicio: inicio,
          data_hora_termino: termino,
          is_visitante: 1,
          is_prestador: i % 5 === 0 ? 1 : 0,
          id_apartamento: apto.id,
          id_condominio: idCond,
        },
      });
      visCount++;
    } catch {}
  }
  console.log(`   → ${visCount} visitantes\n`);

  // 11. Encomendas (250)
  console.log('📦 Encomendas (250)...');
  let encCount = 0;
  for (let i = 0; i < 250; i++) {
    const apto = rand(apartamentos);
    const status = rand(STATUS_ENCOMENDA);
    const recebido = randDate(60);
    const retirado = status === 'Retirada' ? new Date(recebido.getTime() + randInt(3600000, 7 * 86400000)) : null;
    try {
      await prisma.encomendas.create({
        data: {
          descricao: `[TESTE] Pacote ${i + 1} - ${rand(['Caixa pequena', 'Caixa média', 'Caixa grande', 'Envelope'])}`,
          destinatario_apto: apto.apto || '',
          destinatario_bloco: apto.bloco,
          recebido_de: rand(RECEBIDO_DE),
          recebido_em: recebido,
          retirado_em: retirado,
          retirado_por: retirado ? fullName() : null,
          status,
          id_condominio: idCond,
        },
      });
      encCount++;
    } catch {}
  }
  console.log(`   → ${encCount} encomendas\n`);

  // 12. Ocorrências (80)
  console.log('⚠️  Ocorrências (80)...');
  const descrs = [
    'Barulho excessivo no apartamento vizinho',
    'Lâmpada do corredor queimada há 3 dias',
    'Lixo acumulado na garagem',
    'Vazamento no teto da garagem',
    'Portão da garagem com defeito',
    'Pessoa suspeita rondando o prédio',
    'Câmera de segurança quebrada',
    'Cheiro de gás no andar',
  ];
  let ocoCount = 0;
  for (let i = 0; i < 80; i++) {
    const m = rand(moradoresCriados);
    if (!m) continue;
    try {
      await prisma.ocorrencias.create({
        data: {
          descricao: `[TESTE] ${rand(descrs)}`,
          user: m.user.id,
          id_condominio: idCond,
          tipo: rand(categorias).id,
          status: rand(STATUS_OCORRENCIA),
        },
      });
      ocoCount++;
    } catch {}
  }
  console.log(`   → ${ocoCount} ocorrências\n`);

  // 13. Comunicados (20)
  console.log('📢 Comunicados (20)...');
  const titulosCom = [
    'Manutenção da piscina', 'Dedetização programada', 'Reunião de condomínio',
    'Mudança no horário da portaria', 'Limpeza da caixa d\'água', 'Falta d\'água',
    'Festa de fim de ano', 'Eleição de síndico', 'Reforma da fachada',
    'Novo regimento interno', 'Coleta seletiva', 'Vacinação de animais',
  ];
  for (let i = 0; i < 20; i++) {
    const tema = rand(titulosCom);
    await prisma.comunicados.create({
      data: {
        titulo: `[TESTE] ${tema} - #${i + 1}`,
        descricao: `Prezados moradores, comunicamos que ${tema.toLowerCase()} ocorrerá em breve. Detalhes adicionais serão enviados em comunicado complementar.\n\nAtenciosamente,\nAdministração.`,
        user: SINDICO_USER_ID,
        id_condominio: idCond,
      },
    });
  }
  console.log(`   → 20 comunicados\n`);

  // 14. Assembleias (5) + votações
  console.log('🗳️  Assembleias (5) + votações...');
  for (let i = 0; i < 5; i++) {
    const data = i < 3 ? futureDate(60) : randDate(120);
    const assemb = await prisma.assembleias.create({
      data: {
        titulo: `[TESTE] Assembleia ${i < 3 ? 'Ordinária' : 'Extraordinária'} #${i + 1}`,
        descricao: 'Pauta: aprovação de contas, eleição de comissão e demais assuntos gerais.',
        data,
        hora: new Date(1970, 0, 1, 19, 30, 0),
        local: rand(['Salão Principal', 'Salão Gourmet', 'Auditório']),
        link: 'https://meet.google.com/abc-defg-hij',
        user: SINDICO_USER_ID,
        id_condominio: idCond,
      },
    });
    // 1-2 votações por assembleia
    const numVot = randInt(1, 2);
    for (let v = 0; v < numVot; v++) {
      const votacao = await prisma.votacoes.create({
        data: {
          titulo: `[TESTE] Aprovação ${v + 1} da assembleia #${i + 1}`,
          descricao: 'Voto sobre item da pauta.',
          data_inicio: randDate(10),
          data_termino: futureDate(20),
          id_assembleia: assemb.id,
          id_condominio: idCond,
          is_enquete: 0,
        },
      });
      const opcs = ['Aprovar', 'Rejeitar', 'Abster'];
      await prisma.votacoes_Opcoes.createMany({
        data: opcs.map((nome) => ({ id_votacao: votacao.id, nome })),
      });
    }
  }
  // Enquetes soltas (3)
  for (let i = 0; i < 3; i++) {
    const enq = await prisma.votacoes.create({
      data: {
        titulo: `[TESTE] Enquete: ${rand(['Pintura', 'Academia', 'Câmeras', 'Lazer'])} - #${i + 1}`,
        descricao: 'O que você acha sobre essa proposta?',
        data_inicio: randDate(15),
        data_termino: futureDate(30),
        id_condominio: idCond,
        is_enquete: 1,
      },
    });
    await prisma.votacoes_Opcoes.createMany({
      data: [
        { id_votacao: enq.id, nome: 'Sim, concordo' },
        { id_votacao: enq.id, nome: 'Indiferente' },
        { id_votacao: enq.id, nome: 'Não concordo' },
      ],
    });
  }
  console.log('   → 5 assembleias + 3 enquetes\n');

  // 15. Financeiro (400 lançamentos)
  console.log('💰 Lançamentos financeiros (400)...');
  const finData: any[] = [];
  for (let i = 0; i < 400; i++) {
    const isDespesa = i % 3 === 0; // 1/3 despesas
    const tipo = isDespesa ? 'D' : 'C';
    const cat = isDespesa ? rand(CATEGORIAS_FIN_DESPESA) : rand(CATEGORIAS_FIN_RECEITA);
    const valor = isDespesa ? -randInt(50, 5000) : randInt(100, 800);
    const meses = randInt(0, 5);
    const data = new Date();
    data.setMonth(data.getMonth() - meses);
    data.setDate(randInt(1, 28));
    const pago = i % 4 !== 0 ? 1 : 0; // 75% pago
    finData.push({
      nome: `[TESTE] ${cat} ${i + 1}`,
      tipo,
      valor,
      data: pago ? data : null,
      data_vencimento: data,
      categoria: cat,
      conta: 'Banco do Brasil',
      descricao: `Lançamento de teste #${i + 1}`,
      cliente: isDespesa ? null : `Apto ${rand(apartamentos).apto}`,
      forma_pagamento: rand(['PIX', 'Boleto', 'Transferência', 'Dinheiro']),
      nome_operador: '[SEED]',
      id_condominio: idCond,
      pago,
      status: pago ? '1' : '0',
    });
  }
  for (const lote of chunk(finData, 50)) {
    await prisma.financeiro.createMany({ data: lote });
  }
  console.log('   → 400 lançamentos\n');

  // 16. Documentos (30)
  console.log('📄 Documentos (30)...');
  const docs: any[] = [];
  for (let i = 0; i < 30; i++) {
    const isAta = i < 10;
    docs.push({
      nome: isAta
        ? `[TESTE] ATA ${i + 1} - Assembleia ${i % 5 + 1}/2026`
        : `[TESTE] ${rand(['Regimento', 'Convenção', 'Estatuto', 'Política'])} v${i + 1}`,
      link_doc: `https://example.com/doc-teste-${i + 1}.pdf`,
      is_ata: isAta ? 1 : 0,
      id_condominio: idCond,
    });
  }
  await prisma.documentos.createMany({ data: docs });
  console.log('   → 30 documentos\n');

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✅ Seed concluído em ${dt}s. Condomínio "Teste Banco" (id=${idCond}) populado.\n`);
  console.log('   Para apagar tudo depois:');
  console.log(`     DELETE FROM Condominios WHERE id=${idCond};   (cascateia o resto)\n`);
}

main()
  .catch((err) => {
    console.error('💥', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
