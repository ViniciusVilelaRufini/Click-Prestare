var nodemailer = require('nodemailer');

module.exports = {

    mailForgotPassword: async function(emailToSend, newPassword, login_type){
      return new Promise( (resolve, reject) => {
        message = `
                    Olá,<br><br>
                    Você ou alguém solicitou a recuperação de senha do App PRESTARE.<br><br>
                    Utilize a senha abaixo para entrar na sua conta como ${login_type}:<br>
                    <b>${newPassword}</b>
                    <br><br>
                    Atenciosamente,<br>
                    Equipe PRESTARE
                    `;        

        var remetente = nodemailer.createTransport({
            service: "gmail",
            port: 465,
            secure: true,
            auth: {
              user: "nao.responder.click@gmail.com",
              pass: "ckwx hqdm vabv rdre"
            }
          });
          var emailASerEnviado = {
            from: 'nao.responder.click@gmail.com',
            to: emailToSend,
            subject: `PRESTARE - Recuperação de Senha`,
            text: '',
            html: message,
          };
          remetente.sendMail(emailASerEnviado, function(error){
            console.log(error);
              if (error) {
                reject(Error("Falha no envio do e-mail"))
              } else {
                resolve(true)
              }
          });
      })    
    },

    mailWelcomeMorador: async function(emailToSend, nomeMorador, documentoSenha){
      return new Promise( (resolve, reject) => {
        const message = `
                    Olá, <b>${nomeMorador}</b>!<br><br>
                    O seu acesso ao aplicativo <b>PRESTARE</b> foi criado com sucesso.<br><br>
                    Para acessar sua conta como <b>Morador</b>, baixe o aplicativo e utilize as credenciais abaixo:<br><br>
                    <b>Login (E-mail):</b> ${emailToSend}<br>
                    <b>Senha Inicial:</b> ${documentoSenha || '123456'}<br><br>
                    <i>Recomendamos que você altere sua senha após o primeiro acesso no menu de Configurações do App.</i><br><br>
                    Seja muito bem-vindo(a)!<br>
                    Equipe PRESTARE
                    `;        

        var remetente = nodemailer.createTransport({
            service: "gmail",
            port: 465,
            secure: true,
            auth: {
              user: "nao.responder.click@gmail.com",
              pass: "ckwx hqdm vabv rdre"
            }
          });
          var emailASerEnviado = {
            from: 'nao.responder.click@gmail.com',
            to: emailToSend,
            subject: "PRESTARE - Bem-vindo(a)! Suas credenciais de acesso",
            text: '',
            html: message,
          };
          remetente.sendMail(emailASerEnviado, function(error){
              if (error) {
                reject(Error("Falha no envio do e-mail"))
              } else {
                resolve(true)
              }
          });
      })    
    },

}