$ErrorActionPreference = 'Stop'

$nodeScript = @'
const mysql = require('mysql2/promise');
(async () => {
  const db = await mysql.createConnection(process.env.DATABASE_URL);
  const one = async (sql) => { const [rows] = await db.query(sql); return Number(rows[0]?.n ?? 0); };
  const result = {
    pessoas: await one('select count(*) n from pessoas'),
    visitas: await one('select count(*) n from visitas'),
    legacyVisitantes: await one('select count(*) n from Visitantes'),
    acessosFacial: await one('select count(*) n from Acessos_Facial'),
    visitasOrfas: await one('select count(*) n from visitas v left join pessoas p on p.id=v.id_pessoa where p.id is null'),
    pessoaCondoMismatch: await one('select count(*) n from visitas v join pessoas p on p.id=v.id_pessoa where v.id_condominio<>p.id_condominio'),
    aptoCondoMismatch: await one('select count(*) n from visitas v join Apartamentos a on a.id=v.id_apartamento where v.id_condominio<>a.id_condominio'),
    pessoasOrfas: await one('select count(*) n from pessoas p left join Condominios c on c.id=p.id_condominio where c.id is null'),
    activePinDuplicateGroups: await one('select count(*) n from (select codigo_acesso from visitas where codigo_acesso is not null and data_saida is null group by codigo_acesso having count(*) > 1) x'),
    openExpired: await one('select count(*) n from visitas where data_saida is null and data_hora_termino is not null and data_hora_termino < now()')
  };
  process.stdout.write(JSON.stringify(result));
  await db.end();
})().catch((error) => { console.error(error.message); process.exit(1); });
'@

$nodeScript | node -
