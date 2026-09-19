var nodemailer = require('nodemailer');

function escapeHtml(val) {
  return String(val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const EMAIL_FOOTER = `
  <br>
  <table style="font-family: Arial, Helvetica, sans-serif; border-collapse: collapse; margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
    <tr>
      <td style="vertical-align: middle; padding-right: 14px;">
        <img src="https://www.clickprestarecondominios.com.br/logo-prestare.png" alt="Logo Prestare" width="46" height="46" style="border-radius: 6px; display: block;" />
      </td>
      <td style="vertical-align: middle; font-size: 13px; line-height: 1.4; color: #334155;">
        <strong style="color: #0f172a; font-size: 14px;">Prestare - Gestao</strong><br>
        <span style="font-style: italic; color: #64748b;">Declaração de missão</span><br>
        <a href="https://www.clickprestarecondominios.com.br" style="color: #2563eb; text-decoration: none;" target="_blank">https://www.clickprestarecondominios.com.br</a>
      </td>
    </tr>
  </table>
`;

module.exports = {

    mailForgotPassword: async function(emailToSend, newPassword, login_type){
      return new Promise( (resolve, reject) => {
        const text = `Olá!\n\nVocê ou alguém solicitou a recuperação de senha do aplicativo PRESTARE.\n\nUtilize a nova senha temporária abaixo para entrar na sua conta como ${login_type}:\n${newPassword}\n\nPor segurança, altere sua senha nas configurações logo após o primeiro acesso.\n\nEquipe PRESTARE Condomínios\nhttps://www.clickprestarecondominios.com.br`;
        const html = `
          <!DOCTYPE html>
          <html lang="pt-BR">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>PRESTARE - Recuperação de Senha</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px 10px;">
            <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
              <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #0f172a; margin: 0; font-size: 20px; font-weight: 700;">Recuperação de Senha</h2>
              </div>
              <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
                Olá!<br><br>
                Você ou alguém solicitou a recuperação de senha da sua conta no aplicativo <b>PRESTARE</b>.<br><br>
                Utilize a nova senha temporária abaixo para entrar como <b>${escapeHtml(login_type)}</b>:
              </p>

              <div style="text-align: center; margin: 24px 0;">
                <span style="display: inline-block; font-size: 28px; font-weight: 800; letter-spacing: 4px; color: #1e3a8a; background-color: #f1f5f9; padding: 12px 28px; border-radius: 8px; border: 1px dashed #94a3b8; font-family: monospace;">
                  ${escapeHtml(newPassword)}
                </span>
              </div>

              <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0 0 20px 0;">
                ⚠️ <i>Por motivos de segurança, altere sua senha nas configurações do aplicativo logo após o primeiro acesso.</i>
              </p>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
              <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                Equipe PRESTARE Condomínios
              </p>
            </div>
            ${EMAIL_FOOTER}
          </body>
          </html>
        `;

        var remetente = nodemailer.createTransport({
            service: "gmail",
            port: 587,
            secure: false,
            auth: {
              user: "suporte@clickprestarecondominios.com.br",
              pass: "njyqoenhmsyzblwa"
            }
          });
          var emailASerEnviado = {
            from: "Prestare Condomínios <suporte@clickprestarecondominios.com.br>",
            replyTo: "suporte@clickprestarecondominios.com.br",
            to: emailToSend,
            subject: `PRESTARE - Recuperação de Senha`,
            text: text,
            html: html,
          };
          remetente.sendMail(emailASerEnviado, function(error){
            if (error) {
              console.log(error);
              reject(Error("Falha no envio do e-mail"))
            } else {
              resolve(true)
            }
          });
      })    
    },

    mailWelcomeMorador: async function(emailToSend, nomeMorador, documentoSenha){
      return new Promise( (resolve, reject) => {
        const text = `Olá, ${nomeMorador}!\n\nO seu acesso ao aplicativo PRESTARE foi criado com sucesso.\nPara acessar sua conta como Morador, baixe o aplicativo e utilize as credenciais abaixo:\n\nLogin (E-mail): ${emailToSend}\nSenha Inicial: ${documentoSenha || '123456'}\n\nRecomendamos que você altere sua senha após o primeiro acesso no menu de Configurações do App.\n\nEquipe PRESTARE Condomínios\nhttps://www.clickprestarecondominios.com.br`;
        const html = `
          <!DOCTYPE html>
          <html lang="pt-BR">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>PRESTARE - Bem-vindo(a)! Suas credenciais de acesso</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px 10px;">
            <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
              <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #0f172a; margin: 0; font-size: 20px; font-weight: 700;">Credenciais de Acesso</h2>
              </div>
              <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
                Olá, <b>${escapeHtml(nomeMorador)}</b>!<br><br>
                O seu acesso ao aplicativo <b>PRESTARE</b> foi criado com sucesso.<br><br>
                Para acessar sua conta como <b>Morador</b>, baixe o aplicativo e utilize as credenciais abaixo:
              </p>

              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 20px 0;">
                <div style="margin-bottom: 14px;">
                  <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Login (E-mail):</span>
                  <div style="font-size: 14px; color: #0f172a; font-weight: 600; margin-top: 4px; word-break: break-all;">
                    ${escapeHtml(emailToSend)}
                  </div>
                </div>
                <div>
                  <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Senha Inicial:</span>
                  <div style="text-align: center; margin: 12px 0 6px 0;">
                    <span style="display: inline-block; font-size: 28px; font-weight: 800; letter-spacing: 4px; color: #1e3a8a; background-color: #ffffff; padding: 12px 28px; border-radius: 8px; border: 1px dashed #94a3b8; font-family: monospace;">
                      ${escapeHtml(documentoSenha || '123456')}
                    </span>
                  </div>
                </div>
              </div>

              <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0 0 20px 0;">
                🔒 <i>Recomendamos que você altere sua senha após o primeiro acesso no menu de Configurações do App.</i>
              </p>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
              <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                Equipe PRESTARE Condomínios
              </p>
            </div>
            ${EMAIL_FOOTER}
          </body>
          </html>
        `;

        var remetente = nodemailer.createTransport({
            service: "gmail",
            port: 587,
            secure: false,
            auth: {
              user: "suporte@clickprestarecondominios.com.br",
              pass: "njyqoenhmsyzblwa"
            }
          });
          var emailASerEnviado = {
            from: "Prestare Condomínios <suporte@clickprestarecondominios.com.br>",
            replyTo: "suporte@clickprestarecondominios.com.br",
            to: emailToSend,
            subject: "PRESTARE - Bem-vindo(a)! Suas credenciais de acesso",
            text: text,
            html: html,
          };
          remetente.sendMail(emailASerEnviado, function(error){
              if (error) {
                console.log(error);
                reject(Error("Falha no envio do e-mail"))
              } else {
                resolve(true)
              }
          });
      })    
    },

}