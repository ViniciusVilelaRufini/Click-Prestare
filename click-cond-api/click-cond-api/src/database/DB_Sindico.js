const db = require('./MySQL.js');
const { default: slugify } = require('slugify');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

/**
 * Verifica a senha em texto puro contra o hash armazenado.
 * Suporta hashes bcrypt ($2a/$2b/$2y...) e hashes MD5 legados (32 hex chars).
 */
function verifyPassword(plain, stored) {
  if (!stored) return false;
  if (stored.startsWith('$2')) {
    return bcrypt.compareSync(plain, stored);
  }
  // Legado: senhas antigas guardadas como MD5
  const md5 = crypto.createHash('md5').update(plain).digest('hex');
  return md5 === stored;
}

module.exports = {
  insertUser: async function(email, password, photo){
    const query = `insert into Users (login, password, is_sindico)
                        values ('${email}',  MD5('${password}'), 1)`;

    const response = await db.query(query);
    
    if(response.status == 'Error'){
      if (response.error.sqlMessage && response.error.sqlMessage.includes('user_login')) {
        throw new Error('E-mail já cadastrado!');
      }
      throw new Error('Houve um erro ao realizar o seu cadastro. Por favor, tente novamente!');
    }

    return response.results.insertId;
  },

  insertSindico: async function (nome, email, date_birth, phone, doc_identification, userId) {
    let dt = null;
    if (date_birth && date_birth.includes("/")) {
      const parts = date_birth.split("/");
      dt = parts[2]+"-"+parts[1]+"-"+parts[0];
    } else if (date_birth && date_birth.includes("-")) {
      dt = date_birth;
    }

    nome = nome.replaceAll("'","''");

    const querySindico = `insert into Sindicos (
            name, email, date_birth, phone, doc_identification, id_user)
            values ('${nome}','${email}',${dt ? `'${dt}'` : 'NULL'},'${phone}','${doc_identification}', '${userId}')`;
    await db.query(querySindico);
  },

  updateSindico: async function (nome, email, date_birth, phone, doc_identification, userId) {
    let dt = null;
    if (date_birth && date_birth.includes("/")) {
      const parts = date_birth.split("/");
      dt = parts[2]+"-"+parts[1]+"-"+parts[0];
    } else if (date_birth && date_birth.includes("-")) {
      dt = date_birth;
    }

    nome = nome.replaceAll("'","''");
    
    const querySindico = `update Sindicos set 
                     name='${nome}',
                     email='${email}',
                     date_birth=${dt ? `'${dt}'` : 'NULL'},
                     phone='${phone}',
                     doc_identification='${doc_identification}'                   
                    where id_user=${userId}`;
    await db.query(querySindico);
  },

  login: async function (login, password) {
    const query = `select u.id, s.name, u.photo, u.password
                    from Sindicos s
                    inner join Users u on u.id = s.id_user
                    where u.login='${login}'`;
    const result = await db.query(query);
    const user = result.results[0];
    if (!user || !verifyPassword(password, user.password)) {
      throw new Error('Login ou Senha incorretos');
    }
    delete user.password;
    return user;
  },

  internalLogin: async function (login) {
    const query = `select u.id, s.name, u.photo                           
                    from Sindicos s 
                    inner join Users u on u.id = s.id_user
                    where u.login='${login}'`;
    const result = await db.query(query);
    if (!result.results[0]) {
      throw new Error('Login ou Senha incorretos');
    }
    return result.results[0];
  },

  recoveryPassword: async function (email) {
    const query = `select count(id) as count
                            from Authors  
                            where email='${email}'`;
    const result = await db.query(query);
    if (result.results[0].count == 0) {
      throw new Error('Usuário não localizado!');
    }
  },

  setNewPassword: async function (email, password) {
    const query = `update Authors set password=MD5('${password}') where email='${email}' `;
    await db.query(query);
  },  

  
  listCondominios: async function (id) {
    // Subselect do vínculo de morador do síndico naquele condomínio (apto mais recente),
    // para devolver os campos de apartamento quando o síndico também é morador.
    const linkApto = (col) => `(
      select ap.${col} from Apartamentos_Users au
        inner join Apartamentos ap on ap.id = au.id_apto
        where au.id_user = sc.id_user and ap.id_condominio = c.id
        order by au.id desc limit 1)`;
    const query = `select c.id, c.num_blocos, c.moeda,
                    DATE_FORMAT(c.updated_at, '%d/%m/%Y às %H:%i') as updatedAt,
                    c.nome, c.photo, sum(f.valor) as saldo,
                    (SELECT DATE_FORMAT(created_at, '%d/%m/%Y') FROM Financeiro WHERE id_condominio = c.id ORDER BY id DESC LIMIT 1) as data_financeiro,
                    (select count(id) from Apartamentos where id_condominio=c.id) as num_aptos,
                    DATE_FORMAT(c.vencimento, '%d/%m/%Y') as vencimento_condominio,
                    (DATEDIFF(c.vencimento, NOW()) + 1) as dias_restantes_condominio,
                    ${linkApto('id')} as apto_id,
                    ${linkApto('apto')} as apto,
                    ${linkApto('bloco')} as apto_bloco,
                    (select au.tipo from Apartamentos_Users au
                       inner join Apartamentos ap on ap.id = au.id_apto
                       where au.id_user = sc.id_user and ap.id_condominio = c.id
                       order by au.id desc limit 1) as apto_tipo
                    from Sindicos_Condominios sc
                      inner join Condominios c on sc.id_condominio = c.id
                      left join Financeiro f on (f.id_condominio=c.id and f.pago=1 )
                      where sc.id_user=${id} and c.ativo=1
                    group by c.id
                    order by c.created_at desc`;
    const { results } = await db.query(query);
    return results;
  },

  listSindicosCondominio: async function (idCond) {
    const query = `select s.id_user, s.name as nome, s.email
                    from Sindicos_Condominios sc
                      inner join Sindicos s on s.id_user = sc.id_user
                    where sc.id_condominio=${Number(idCond)}`;
    const { results } = await db.query(query);
    return results;
  },
  
  getData: async function (id) {
    const query = `select s.name, s.email, DATE_FORMAT(s.date_birth, '%d/%m/%Y') as date_birth, s.phone, s.doc_identification, u.photo 
                    from Sindicos s
                    inner join Users u on s.id_user = u.id
                    where s.id_user=${id}`;    
    const { results } = await db.query(query);
    return results[0];
  }, 
};

