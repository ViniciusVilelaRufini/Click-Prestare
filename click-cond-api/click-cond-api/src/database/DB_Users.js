const db = require('./MySQL.js');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

module.exports = {
  login: async function (email, password, login_type) {
    const queryVerify = `select login_type from Users where email=? and login_type != ?`;
    const { results: resVerifyEmail } = await db.queryParam(queryVerify, [email, login_type]);
    if (resVerifyEmail && resVerifyEmail.length > 0) {
      throw new Error(`Este e-mail está vinculado ao acesso pelo ${resVerifyEmail[0].login_type}`);
    }

    const query = `select id, name, email, profile_image, password 
                   from Users where email=? and login_type=?`;
    const { results } = await db.queryParam(query, [email, login_type]);
    if (!results || results.length == 0) {
      throw new Error('Login ou Senha incorretos');
    }

    const user = results[0];
    const md5Password = crypto.createHash('md5').update(password).digest("hex");

    let isMatch = false;
    if (user.password.startsWith('$2')) {
       // It's a bcrypt hash
       isMatch = await bcrypt.compare(password, user.password);
    } else {
       // Legacy MD5 check
       isMatch = (user.password === md5Password);
       if (isMatch) {
          // Seamless migration to bcrypt
          const newHash = await bcrypt.hash(password, 10);
          await db.queryParam(`UPDATE Users SET password=? WHERE id=?`, [newHash, user.id]);
       }
    }

    if (!isMatch) {
      throw new Error('Login ou Senha incorretos');
    }
    
    delete user.password;
    return user;
  },

  signup: async function (name, email, cpf, password, image, login_type) {
    name = name.replaceAll("'","''");
    const hash = await bcrypt.hash(password, 10);

    let query = '';
    let params = [];
    if (cpf != null) {
      query = `insert into Users (name, email, password, cpf, login_type) values (?, ?, ?, ?, ?)`;
      params = [name, email, hash, cpf, login_type];
    } else {
      if (image) {
        query = `insert into Users (name, email, password, login_type, profile_image) values (?, ?, ?, ?, ?)`;
        params = [name, email, hash, login_type, image];
      } else {
        query = `insert into Users (name, email, password, login_type) values (?, ?, ?, ?)`;
        params = [name, email, hash, login_type];
      }
    }

    const response = await db.queryParam(query, params);
    if(response.status == 'Error'){
      if (response.error.sqlMessage.includes('uni_email')) {
        throw new Error('E-mail já cadastrado!');
      }
      if (response.error.sqlMessage.includes('uni_cpf')) {
        throw new Error('CPF já cadastrado!');
      }
      throw new Error('Houve um erro ao realizar o seu cadastro. Por favor, revise os dados pessoais (nome/email/cpf) e tente novamente!');
    }
  },

  updateProfilePhoto: async function (url, id){
    const query = `update Users set photo='${url}' where id='${id}' `;
    console.log(query);
    await db.query(query);
  },

  updateEmail: async function(id, email){
    const query = `update Users set login='${email}', email='${email}' where id=${id}`;

    await db.query(query).then((response) => {  
      if(response.status == 'Error'){
        if (response.error.sqlMessage && response.error.sqlMessage.includes('user_login')) {
          throw new Error('E-mail já cadastrado!');
        }
        throw new Error('Houve um erro ao realizar a atualização. Por favor, tente novamente!');
      }
    }); 
  },

  recoveryPassword: async function (email, is_sindico, is_morador, is_funcionario) {
    const query = `select * from Users where login='${email}'`;
    const result = await db.query(query);
    if (result.results.length == 0) {
      throw new Error('E-mail não localizado!');
    }
    var login_type = result.results[0].is_sindico == 1 ? "Síndico"
                      : result.results[0].is_morador == 1 ? "Morador"
                      : "Funcionário";
    if (is_sindico == true && login_type != 'Síndico') {
      throw new Error(`Este e-mail está vinculado ao acesso de ${login_type}`);
    }
    if (is_morador == true && login_type != 'Morador') {
      throw new Error(`Este e-mail está vinculado ao acesso de ${login_type}`);
    }
    if (is_funcionario == true && login_type != 'Funcionário') {
      throw new Error(`Este e-mail está vinculado ao acesso de ${login_type}`);
    }
    return login_type;
  },

  setNewPassword: async function (email, password) {
    const hash = await bcrypt.hash(password, 10);
    const query = `update Users set password=? where login=?`;
    await db.queryParam(query, [hash, email]);
  },

  setNewPasswordById: async function (id, password) {
    const hash = await bcrypt.hash(password, 10);
    const query = `update Users set password=? where id=?`;
    await db.queryParam(query, [hash, id]);
  },

  listMyFavoritesProducts: async function (idUser) {
    const query = `select p.id as id, p.title as title, p.images as image
						from Products p 
						inner join Products_Favorites pf on pf.id_product = p.id
						where pf.id_user=${idUser} order by pf.created_at desc`;
    const { results } = await db.query(query);
    return results;
  },

  listMyFavoritesAuthors: async function (idUser) {
    const query = `select a.id as id, a.name as name, a.profile_image as image
						from Authors a 
						inner join Authors_Favorites af on af.id_author = a.id
						where af.id_user=${idUser} order by af.created_at desc`;
    const { results } = await db.query(query);
    return results;
  },

  checkExistUser: async function (email) {
    const query = `select count(id) as count from Users where email='${email}'`;
    const { results } = await db.query(query);
    return results[0].count;
  },

  getCart: async function (idUser) {
    const query = `SELECT id AS idCart, id_user as idUser, id_product as idProduct, quantity FROM Shopping_Cart WHERE id_user = ${idUser}`;
    const { results } = await db.query(query);
    return results;
  },

  getShoppingCartDetailed: async function (idUser) {
    const query = `SELECT p.id, p.slug, p.title, p.description, p.price, p.images, p.is_fisico FROM Shopping_Cart AS sc
		INNER JOIN Products AS p ON p.id = sc.id_product
		WHERE sc.id_user = ${idUser};`;

    const { results } = await db.query(query);
    return results;
  },

  saveToCart: async function (idCart = undefined, idUser, idProduct, quantity = 1) {
    let query = `INSERT INTO Shopping_Cart(id_user, id_product, quantity) VALUES(${idUser}, ${idProduct}, ${quantity})`;

    if (idCart && quantity !== 0) {
      query = `UPDATE Shopping_Cart SET quantity = ${quantity} WHERE id_user = ${idUser} AND id_product = ${idProduct}`;
    }
    if (idCart && quantity === 0) {
      query = `DELETE FROM Shopping_Cart WHERE id = ${idCart}`;
    }

    await db.query(query);
  },

  getMyAddress: async function (idUser) {
    const query = `SELECT a.cep, a.city, a.complement, a.country, a.street, a.uf, a.number, a.neighborhood, 
							u.phone, SUBSTRING_INDEX(u.name, ' ', 1) AS name,
							SUBSTRING_INDEX(u.name, ' ', -1) AS familyName, u.cpf
						from Users u left join Addresses a on u.address = a.id
							where u.id = ${idUser} `;

    const { results } = await db.query(query);
    return results[0];
  },

  updateAddress: async function (address, id) {
    const query = `update Addresses set cep='${address.cep}', street='${address.street}',
						number=${address.number}, complement='${address.complement}', 
						neighborhood='${address.neighborhood}', city='${address.city}',
						country='${address.country}' where id=${id}`;
    await db.query(query);
    // return results[0];
  },

  insertAddress: async function (address) {
    address.street = address.street.replaceAll("'","''");
    address.complement = address.complement.replaceAll("'","''");
    address.neighborhood = address.neighborhood.replaceAll("'","''");
    address.city = address.city.replaceAll("'","''");

    const query = `insert into Addresses (
						cep, street, number, complement, neighborhood, city, uf, country)
						values ('${address.cep}','${address.street}',${address.number},'${address.complement}',
								'${address.neighborhood}','${address.city}','${address.uf}','${address.country}')`;
    await db.query(query);
  },

  updateUserPayment: async function (hasAddress, phone, id) {
    const query = `update Users set phone='${phone}' 
						${!hasAddress ? ', address=(select max(id) from Addresses)' : ''}
						where id=${id}`;
    await db.query(query);
  },

  saveOrder: async function (paymentId, userId, shoppingCartResult, price) {
    const queryOrder = `insert into Orders (id_user, price, payment_id)
						values ('${userId}','${price}','${paymentId}')`;

    const queryGetOrderId = 'select max(id) as id from Orders';

    await db.query(queryOrder);
    const { results } = await db.query(queryGetOrderId);

    const queryProducts = `insert into Products_Orders (id_order, id_product, price, quantity, present)
							values ${shoppingCartResult.map(e =>
      `(${results[0].id}, ${e.id}, ${e.price}, 1, 0)`
    )}`.replace(/,\s*$/, '');
    await db.query(queryProducts);
    return results[0].id;
  },

  cleanCart: async function (userId) {
    const queryOrder = `delete from Shopping_Cart where id_user=${userId}`;
    await db.query(queryOrder);
  },

  getUserInfo: async function (userId) {
    const query = `select * from Users where id=${userId}`;
    const { results } = await db.query(query);
    return results[0];
  },

  getMyhistory: async function (idUser) {
    const query = `
            select
              o.*,
              o.id as id_order,
              o.created_at as bought_in,
              DATE_FORMAT(o.created_at,'%d/%m/%Y') as bought_in,
              DATE_FORMAT(received_at,'%d/%m/%Y') as received_at,
              DATE_FORMAT(dispatched_at,'%d/%m/%Y') as dispatched_at,
              DATE_FORMAT(transport_at,'%d/%m/%Y') as transport_at,
              DATE_FORMAT(delivered_at,'%d/%m/%Y') as delivered_at,
              po.price,
              po.quantity,
              po.present,
              p.id as id_product,
              p.title,
              p.images,
              a.id as id_address,
              a.*
						from Orders o inner join Products_Orders po on o.id = po.id_order
						inner join Products p on p.id = po.id_product
            inner join Addresses a on o.address = a.id
						where o.id_user=${idUser} order by o.id desc
    `;

    const { results } = await db.query(query);
    return results;
  },

  updateFcmToken: async function (id, token) {
    const query = `UPDATE Users SET fcm_token=? WHERE id=?`;
    await db.queryParam(query, [token, id]);
  },

  syncUserProfile: async function (userId, data) {
    const name = data.name || data.nome || null;
    const email = data.email || null;
    const phone = data.phone || data.telefone || null;
    const doc = data.doc_identification || data.documento || data.cpf || null;
    let dob = data.date_birth || data.data_nascimento || null;

    let dt = null;
    if (dob) {
      if (dob.includes("/")) {
        const parts = dob.split("/");
        dt = parts[2] + "-" + parts[1] + "-" + parts[0];
      } else if (dob.includes("-")) {
        dt = dob.split("T")[0];
      }
    }

    // 1. Update Users table
    if (name || doc || phone) {
      const updateFields = [];
      const params = [];
      if (name) {
        updateFields.push("name = ?");
        params.push(name);
      }
      if (doc) {
        updateFields.push("cpf = ?");
        params.push(doc);
      }
      if (phone) {
        updateFields.push("phone = ?");
        params.push(phone);
      }
      if (updateFields.length > 0) {
        params.push(userId);
        const queryUsers = `UPDATE Users SET ${updateFields.join(', ')} WHERE id = ?`;
        await db.queryParam(queryUsers, params);
      }
    }

    // 2. Update Sindicos table
    if (name || email || dt || phone || doc) {
      const updateFields = [];
      const params = [];
      if (name) {
        updateFields.push("name = ?");
        params.push(name);
      }
      if (email) {
        updateFields.push("email = ?");
        params.push(email);
      }
      if (dt) {
        updateFields.push("date_birth = ?");
        params.push(dt);
      } else if (dob === null) {
        updateFields.push("date_birth = NULL");
      }
      if (phone) {
        updateFields.push("phone = ?");
        params.push(phone);
      }
      if (doc) {
        updateFields.push("doc_identification = ?");
        params.push(doc);
      }
      if (updateFields.length > 0) {
        params.push(userId);
        const querySindicos = `UPDATE Sindicos SET ${updateFields.join(', ')} WHERE id_user = ?`;
        await db.queryParam(querySindicos, params);
      }
    }

    // 3. Update Moradores table
    if (name || email || dt || phone || doc) {
      const updateFields = [];
      const params = [];
      if (name) {
        updateFields.push("nome = ?");
        params.push(name);
      }
      if (email) {
        updateFields.push("email = ?");
        params.push(email);
      }
      if (dt) {
        updateFields.push("data_nascimento = ?");
        params.push(dt);
      } else if (dob === null) {
        updateFields.push("data_nascimento = NULL");
      }
      if (phone) {
        updateFields.push("telefone = ?");
        params.push(phone);
      }
      if (doc) {
        updateFields.push("documento = ?");
        params.push(doc);
      }
      if (updateFields.length > 0) {
        params.push(userId);
        const queryMoradores = `UPDATE Moradores SET ${updateFields.join(', ')} WHERE id_user = ?`;
        await db.queryParam(queryMoradores, params);
      }
    }

    // 4. Update Funcionarios table
    if (name || email || phone || doc) {
      const updateFields = [];
      const params = [];
      if (name) {
        updateFields.push("nome = ?");
        params.push(name);
      }
      if (email) {
        updateFields.push("email = ?");
        params.push(email);
      }
      if (phone) {
        updateFields.push("telefone = ?");
        params.push(phone);
      }
      if (doc) {
        updateFields.push("documento = ?");
        params.push(doc);
      }
      if (updateFields.length > 0) {
        params.push(userId);
        const queryFuncionarios = `UPDATE Funcionarios SET ${updateFields.join(', ')} WHERE id_user = ?`;
        await db.queryParam(queryFuncionarios, params);
      }
    }
  },

};
