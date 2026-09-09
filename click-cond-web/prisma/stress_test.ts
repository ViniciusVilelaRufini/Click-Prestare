/**
 * Stress Test — popula o banco do Railway com dados em massa para testar todos os módulos.
 * Rodar com: npx tsx prisma/stress_test.ts
 */
import { PrismaClient } from '../apps/api/src/app/prisma/generated';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

function md5(s: string): string {
  return createHash('md5').update(s).digest('hex');
}

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const nomes = [
  'Ana Lima', 'Bruno Souza', 'Carla Mendes', 'Diego Alves', 'Eduarda Costa',
  'Fábio Rocha', 'Gabriela Nunes', 'Henrique Pires', 'Isabela Torres', 'João Moura',
  'Karina Batista', 'Lucas Ferreira', 'Mariana Gomes', 'Nicolas Barbosa', 'Olivia Castro',
  'Pedro Santana', 'Quézia Ribeiro', 'Rafael Teixeira', 'Sabrina Lemos', 'Thiago Araújo',
  'Ursula Cardoso', 'Vinicius Ramos', 'Wanda Pereira', 'Xavier Martins', 'Yara Freitas',
  'Zeca Oliveira', 'Amanda Correia', 'Bernardo Lima', 'Catarina Melo', 'Davi Assis',
];

const documentos = nomes.map((_, i) => `${100 + i}.${200 + i}.${300 + i}-${i % 10}0`);

const nomesPrestadores = [
  'Correio Correios', 'Mercado Bom Preço', 'Magazine Luiza', 'Amazon', 'Shopee',
  'Americanas', 'Casas Bahia', 'iFood Delivery', 'Rappi Express', 'Natuzzi Home',
];

const nomesVisitantes = [
  'Maria das Graças', 'José Santos', 'Francisca Lima', 'Raimundo Costa', 'Antônia Souza',
  'Paulo Ferreira', 'Luzia Alves', 'Marcos Ribeiro', 'Cláudia Gomes', 'Antônio Neves',
  'Benedita Carvalho', 'Sebastião Rocha', 'Teresinha Martins', 'Manoel Barbosa', 'Rosária Castro',
];

const areasLazer = [
  { nome: 'Salão de Festas', horarios: '{"segunda":["08:00-22:00"],"sabado":["08:00-23:00"],"domingo":["10:00-22:00"]}', capacidade: 80, precisa_agendar: 1, precisa_pagamento: 0 },
  { nome: 'Piscina Adulto', horarios: '{"segunda":["08:00-20:00"],"sabado":["08:00-22:00"],"domingo":["08:00-22:00"]}', capacidade: 30, precisa_agendar: 0, precisa_pagamento: 0 },
  { nome: 'Piscina Infantil', horarios: '{"segunda":["08:00-20:00"],"sabado":["08:00-22:00"],"domingo":["08:00-22:00"]}', capacidade: 15, precisa_agendar: 0, precisa_pagamento: 0 },
  { nome: 'Academia', horarios: '{"segunda":["06:00-23:00"],"sabado":["06:00-23:00"],"domingo":["08:00-20:00"]}', capacidade: 20, precisa_agendar: 0, precisa_pagamento: 0 },
  { nome: 'Churrasqueira A', horarios: '{"sabado":["10:00-22:00"],"domingo":["10:00-22:00"]}', capacidade: 25, precisa_agendar: 1, precisa_pagamento: 1 },
  { nome: 'Churrasqueira B', horarios: '{"sabado":["10:00-22:00"],"domingo":["10:00-22:00"]}', capacidade: 25, precisa_agendar: 1, precisa_pagamento: 1 },
  { nome: 'Quadra Poliesportiva', horarios: '{"segunda":["07:00-22:00"],"sabado":["07:00-22:00"],"domingo":["08:00-20:00"]}', capacidade: 20, precisa_agendar: 1, precisa_pagamento: 0 },
  { nome: 'Sauna Seca', horarios: '{"segunda":["08:00-22:00"],"sabado":["08:00-22:00"]}', capacidade: 8, precisa_agendar: 1, precisa_pagamento: 0 },
  { nome: 'Sala de Jogos', horarios: '{"segunda":["10:00-22:00"],"sabado":["10:00-23:00"],"domingo":["10:00-22:00"]}', capacidade: 15, precisa_agendar: 0, precisa_pagamento: 0 },
  { nome: 'Espaço Gourmet', horarios: '{"sabado":["10:00-22:00"],"domingo":["10:00-22:00"]}', capacidade: 40, precisa_agendar: 1, precisa_pagamento: 1 },
];

const descEncomendas = [
  'Caixa de papelão grande', 'Embalagem frágil — eletrônico', 'Sacola plástica — roupas',
  'Caixa media — livros', 'Envelope A4 — documentos', 'Caixa grande — eletrodoméstico',
  'Pacote pequeno — bijuterias', 'Caixa — calçados', 'Embalagem — cosméticos',
  'Caixa de papelão media — utensílios domésticos',
];

const tiposVisitante = [
  { is_visitante: 1, is_prestador: 0 },
  { is_visitante: 1, is_prestador: 0 },
  { is_visitante: 0, is_prestador: 1 },
];

async function main() {
  console.log('🚀 Iniciando stress test de dados...\n');

  // ── Busca condomínio existente
  const condominio = await prisma.condominios.findFirst({
    where: { nome: 'Edifício Demo' },
  });
  if (!condominio) {
    console.error('❌ Condomínio "Edifício Demo" não encontrado. Rode prisma/seed.ts primeiro.');
    process.exit(1);
  }
  console.log(`✓ Usando condomínio: ${condominio.nome} (id=${condominio.id})\n`);

  // ── 1) Apartamentos (expansão — mais blocos/andares)
  console.log('🏠 Criando apartamentos extras...');
  const blocos = ['A', 'B', 'C'];
  const andares = ['1', '2', '3', '4', '5'];
  const unidades = ['01', '02', '03', '04'];
  const aptosExtras: { bloco: string; apto: string }[] = [];

  for (const bloco of blocos) {
    for (const andar of andares) {
      for (const unidade of unidades) {
        const apto = `${andar}${unidade}`;
        const exists = await prisma.apartamentos.findFirst({
          where: { id_condominio: condominio.id, bloco, apto },
        });
        if (!exists) {
          await prisma.apartamentos.create({
            data: { bloco, apto, fracao: '0.020', id_condominio: condominio.id },
          });
          aptosExtras.push({ bloco, apto });
        }
      }
    }
  }
  const todosAptos = await prisma.apartamentos.findMany({
    where: { id_condominio: condominio.id },
  });
  console.log(`  ✓ Total de apartamentos: ${todosAptos.length}\n`);

  // ── 2) Áreas de Lazer
  console.log('🏊 Criando áreas de lazer...');
  for (const area of areasLazer) {
    const exists = await prisma.areas_Sociais.findFirst({
      where: { nome: area.nome, id_condominio: condominio.id },
    });
    if (!exists) {
      await prisma.areas_Sociais.create({
        data: {
          nome: area.nome,
          horarios: area.horarios,
          capacidade: area.capacidade,
          precisa_agendar: area.precisa_agendar,
          precisa_autorizacao: 0,
          precisa_pagamento: area.precisa_pagamento,
          id_condominio: condominio.id,
        },
      });
      console.log(`  ✓ Área criada: ${area.nome}`);
    } else {
      console.log(`  ↺ Área já existe: ${area.nome}`);
    }
  }
  const todasAreas = await prisma.areas_Sociais.findMany({ where: { id_condominio: condominio.id } });
  console.log(`  Total: ${todasAreas.length} áreas de lazer\n`);

  // ── 3) Moradores (30 moradores com Users)
  console.log('👥 Criando moradores...');
  const moradoresCriados: number[] = [];

  for (let i = 0; i < nomes.length; i++) {
    const nome = nomes[i];
    const email = `morador${i + 1}@edificiodemo.com.br`;
    const doc = documentos[i];
    const apto = todosAptos[i % todosAptos.length];

    // Cria User
    let user = await prisma.users.findFirst({ where: { email } });
    if (!user) {
      user = await prisma.users.create({
        data: {
          name: nome,
          email,
          login: email,
          password: md5('123456'),
          cpf: doc.replace(/\D/g, ''),
          phone: `(11) 9${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`,
          is_morador: 1,
          login_type: 'morador',
        },
      });
    }

    // Cria Morador
    const moradorExists = await prisma.moradores.findFirst({ where: { id_user: user.id } });
    if (!moradorExists) {
      await prisma.moradores.create({
        data: {
          nome,
          documento: doc,
          email,
          telefone: user.phone,
          data_nascimento: randomDate(new Date('1970-01-01'), new Date('2000-01-01')),
          id_user: user.id,
          tipo: ['proprietario', 'inquilino', 'dependente'][i % 3],
          bloco: apto.bloco,
          apartamento: apto.apto,
          id_condominio: condominio.id,
          extra1: `Carro: ${['Gol', 'HB20', 'Onix', 'Civic', 'Corolla'][i % 5]}`,
          extra2: `Placa: ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i + 3) % 26))}${String.fromCharCode(65 + ((i + 7) % 26))}-${1000 + i}`,
        },
      });

      // Vincula ao apartamento
      const aptoLink = await prisma.apartamentos_Users.findFirst({
        where: { id_apto: apto.id, id_user: user.id },
      });
      if (!aptoLink) {
        await prisma.apartamentos_Users.create({
          data: {
            id_apto: apto.id,
            id_user: user.id,
            tipo: ['proprietario', 'inquilino', 'dependente'][i % 3],
            vencimento: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          },
        });
      }

      moradoresCriados.push(user.id);
      console.log(`  ✓ Morador: ${nome} — Apto ${apto.bloco}/${apto.apto}`);
    } else {
      moradoresCriados.push(user.id);
      console.log(`  ↺ Morador já existe: ${nome}`);
    }
  }
  console.log(`  Total: ${moradoresCriados.length} moradores\n`);

  // ── 4) Encomendas (50 encomendas variadas)
  console.log('📦 Criando encomendas...');
  const encomendasCriadas = await prisma.encomendas.count({ where: { id_condominio: condominio.id } });
  if (encomendasCriadas < 50) {
    for (let i = 0; i < 50; i++) {
      const apto = todosAptos[i % todosAptos.length];
      const diasAtras = Math.floor(Math.random() * 30);
      const retirada = i < 35; // 70% já retiradas

      await prisma.encomendas.create({
        data: {
          descricao: randomItem(descEncomendas),
          destinatario_apto: apto.apto,
          destinatario_bloco: apto.bloco,
          recebido_de: randomItem(nomesPrestadores),
          recebido_em: new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000),
          retirado_em: retirada ? new Date(Date.now() - (diasAtras - 1) * 24 * 60 * 60 * 1000) : null,
          retirado_por: retirada ? randomItem(nomes) : null,
          status: retirada ? 'Retirada' : 'Aguardando',
          id_condominio: condominio.id,
        },
      });
    }
    console.log('  ✓ 50 encomendas criadas\n');
  } else {
    console.log(`  ↺ Encomendas já existem (${encomendasCriadas})\n`);
  }

  // ── 5) Visitantes (60 registros)
  console.log('🚶 Criando visitantes...');
  const visitantesCriados = await prisma.visitantes.count({ where: { id_condominio: condominio.id } });
  if (visitantesCriados < 60) {
    for (let i = 0; i < 60; i++) {
      const apto = todosAptos[i % todosAptos.length];
      const tipo = randomItem(tiposVisitante);
      const diasAtras = Math.floor(Math.random() * 60);
      const dataEntrada = new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000);
      const dataEntradaTime = new Date(dataEntrada);
      dataEntradaTime.setHours(8 + (i % 10), 0, 0, 0);
      const dataSaida = new Date(dataEntradaTime);
      dataSaida.setHours(dataSaida.getHours() + 2 + (i % 4));

      await prisma.visitantes.create({
        data: {
          nome: randomItem(nomesVisitantes),
          doc_identificacao: `${Math.floor(10000000 + Math.random() * 89999999)}`,
          data_hora_inicio: dataEntradaTime,
          data_hora_termino: i % 5 === 0 ? null : dataSaida, // 20% ainda presentes
          is_visitante: tipo.is_visitante,
          is_prestador: tipo.is_prestador,
          id_apartamento: apto.id,
          id_condominio: condominio.id,
          avisar: 1,
        },
      });
    }
    console.log('  ✓ 60 visitantes criados\n');
  } else {
    console.log(`  ↺ Visitantes já existem (${visitantesCriados})\n`);
  }

  // ── 6) Agendamentos de Áreas Sociais (30 agendamentos)
  console.log('📅 Criando agendamentos de áreas sociais...');
  const areasComAgendamento = todasAreas.filter((a) => a.precisa_agendar);
  if (areasComAgendamento.length > 0 && moradoresCriados.length > 0) {
    const agendamentosExistentes = await prisma.areas_Sociais_Agendamentos.count();
    if (agendamentosExistentes < 30) {
      for (let i = 0; i < 30; i++) {
        const area = randomItem(areasComAgendamento);
        const apto = todosAptos[i % todosAptos.length];
        const userId = randomItem(moradoresCriados);
        const diasFuturos = Math.floor(Math.random() * 60) - 15;
        const data = new Date();
        data.setDate(data.getDate() + diasFuturos);
        const statusOpts: ('pendente' | 'aprovado' | 'recusado')[] = ['pendente', 'aprovado', 'recusado'];

        await prisma.areas_Sociais_Agendamentos.create({
          data: {
            id_area_social: area.id,
            id_user: userId,
            id_apartamento: apto.id,
            data,
            hora_de: new Date(`2000-01-01T09:00:00`),
            hora_ate: new Date(`2000-01-01T12:00:00`),
            status: randomItem(statusOpts),
          },
        });
      }
      console.log('  ✓ 30 agendamentos criados\n');
    } else {
      console.log(`  ↺ Agendamentos já existem (${agendamentosExistentes})\n`);
    }
  }

  // ── 7) Ocorrências (20 ocorrências)
  console.log('⚠️  Criando ocorrências...');
  const categorias = await prisma.ocorrencias_Categorias.findMany();
  const ocorrenciasExistentes = await prisma.ocorrencias.count({ where: { id_condominio: condominio.id } });
  if (categorias.length > 0 && ocorrenciasExistentes < 20) {
    const descOcorrencias = [
      'Barulho excessivo vindo do apartamento acima às 23h',
      'Iluminação queimada no corredor do 3º andar bloco A',
      'Vazamento na garagem perto da vaga 15',
      'Lixo sendo descartado incorretamente na área comum',
      'Câmera de segurança offline no hall de entrada bloco B',
      'Janela da sala de jogos com vidro quebrado',
      'Portão eletrônico travando com frequência',
      'Animal sem guia nos corredores do condomínio',
      'Odor de fumaça no corredor do 2º andar',
      'Infiltração no teto do salão de festas',
    ];
    const statusOpts: ('Pendente' | 'Ciente' | 'Solucionado')[] = ['Pendente', 'Ciente', 'Solucionado'];

    for (let i = 0; i < 20; i++) {
      await prisma.ocorrencias.create({
        data: {
          descricao: descOcorrencias[i % descOcorrencias.length],
          tipo: randomItem(categorias).id,
          status: randomItem(statusOpts),
          id_condominio: condominio.id,
          resposta: i % 3 === 0 ? 'Estamos verificando a situação. Equipe de manutenção já foi acionada.' : null,
        },
      });
    }
    console.log('  ✓ 20 ocorrências criadas\n');
  } else {
    console.log(`  ↺ Ocorrências já existem (${ocorrenciasExistentes})\n`);
  }

  // ── 8) Comunicados (10)
  console.log('📢 Criando comunicados...');
  const comunicadosExistentes = await prisma.comunicados.count({ where: { id_condominio: condominio.id } });
  if (comunicadosExistentes < 10) {
    const comunicados = [
      { titulo: 'Manutenção do Elevador', descricao: 'O elevador social bloco A passará por manutenção preventiva no dia 15/05 das 8h às 12h.' },
      { titulo: 'Assembleia Geral Ordinária', descricao: 'Convocamos todos os moradores para a Assembleia Geral Ordinária em 20/05 às 19h no salão de festas.' },
      { titulo: 'Limpeza da Caixa D\'água', descricao: 'Informamos que a limpeza e desinfecção das caixas d\'água ocorrerá no próximo sábado.' },
      { titulo: 'Novas Regras de Uso da Piscina', descricao: 'A partir de 01/06, o uso da piscina ficará restrito das 8h às 21h nos finais de semana.' },
      { titulo: 'Reforma da Quadra', descricao: 'A quadra poliesportiva estará interditada por 10 dias para reforma do piso.' },
    ];
    for (const com of comunicados) {
      await prisma.comunicados.create({
        data: { ...com, id_condominio: condominio.id },
      });
    }
    console.log('  ✓ Comunicados criados\n');
  } else {
    console.log(`  ↺ Comunicados já existem (${comunicadosExistentes})\n`);
  }

  // ── Resumo Final
  const [totalAptos, totalMoradores, totalEncomendas, totalVisitantes, totalOcorrencias, totalComunicados, totalAgendamentos] = await Promise.all([
    prisma.apartamentos.count({ where: { id_condominio: condominio.id } }),
    prisma.moradores.count({ where: { id_condominio: condominio.id } }),
    prisma.encomendas.count({ where: { id_condominio: condominio.id } }),
    prisma.visitantes.count({ where: { id_condominio: condominio.id } }),
    prisma.ocorrencias.count({ where: { id_condominio: condominio.id } }),
    prisma.comunicados.count({ where: { id_condominio: condominio.id } }),
    prisma.areas_Sociais_Agendamentos.count(),
  ]);

  console.log('═══════════════════════════════════════');
  console.log('📊 RESUMO DO BANCO DE DADOS:');
  console.log(`  🏠 Apartamentos:        ${totalAptos}`);
  console.log(`  👥 Moradores:           ${totalMoradores}`);
  console.log(`  📦 Encomendas:          ${totalEncomendas}`);
  console.log(`  🚶 Visitantes:          ${totalVisitantes}`);
  console.log(`  ⚠️  Ocorrências:         ${totalOcorrencias}`);
  console.log(`  📢 Comunicados:         ${totalComunicados}`);
  console.log(`  📅 Agendamentos:        ${totalAgendamentos}`);
  console.log(`  🏊 Áreas de Lazer:      ${todasAreas.length}`);
  console.log('═══════════════════════════════════════');
  console.log('✅ Stress test concluído com sucesso!');
}

main()
  .catch((e) => {
    console.error('❌ Stress test falhou:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
