import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Resend } from 'resend';
import * as nodemailer from 'nodemailer';
import * as dns from 'dns';
import { promisify } from 'util';

dns.setDefaultResultOrder('ipv4first');
const dnsLookup = promisify(dns.lookup);

const OFFICIAL_EMAIL = 'suporte@clickprestarecondominios.com.br';
const OFFICIAL_PASS = 'njyqoenhmsyzblwa';
const OFFICIAL_NAME = 'Prestare Condomínios';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private resend: Resend | null = null;
  private transporter: nodemailer.Transporter | null = null;
  private readonly fromAddress: string;
  private readonly resendKey?: string;
  private readonly smtpUser?: string;
  private readonly smtpPass?: string;

  constructor() {
    const clean = (s?: string) => (s ? s.trim().replace(/^["']|["']$/g, '') : undefined);
    this.resendKey = clean(process.env.RESEND_API_KEY);

    let smtpUser = clean(process.env.SMTP_USER);
    let smtpPass = clean(process.env.SMTP_PASS)?.replace(/\s+/g, '');

    // Se o ambiente ainda contiver o e-mail pessoal antigo remanescente (ex: console do Elastic Beanstalk),
    // ou se não houver usuário/senha configurados, força o uso exclusivo da conta oficial Google Workspace da Prestare.
    if (!smtpUser || smtpUser.toLowerCase().includes('viniciusrufini') || !smtpPass || smtpPass.toLowerCase().includes('vjty')) {
      this.logger.warn(
        `Substituindo credenciais SMTP residuais/ausentes (${smtpUser}) pelo remetente corporativo oficial: ${OFFICIAL_EMAIL}`,
      );
      smtpUser = OFFICIAL_EMAIL;
      smtpPass = OFFICIAL_PASS;
    }

    this.smtpUser = smtpUser;
    this.smtpPass = smtpPass;

    let fromEmail =
      clean(process.env.MAIL_FROM) ||
      clean(process.env.SMTP_FROM) ||
      this.smtpUser ||
      OFFICIAL_EMAIL;

    if (!fromEmail || fromEmail.toLowerCase().includes('viniciusrufini') || fromEmail === 'onboarding@resend.dev') {
      fromEmail = OFFICIAL_EMAIL;
    }

    const fromName =
      clean(process.env.MAIL_FROM_NAME) ||
      clean(process.env.SMTP_FROM_NAME) ||
      OFFICIAL_NAME;

    this.fromAddress = `${fromName} <${fromEmail}>`;

    this.logger.log(
      `MailService construido. Resend=${!!this.resendKey} SMTP=${!!(
        this.smtpUser && this.smtpPass
      )} from=${this.fromAddress}`,
    );
  }

  async onModuleInit() {
    // Prioriza Resend (HTTP API, sem problema de portas/IPv6).
    if (this.resendKey) {
      this.resend = new Resend(this.resendKey);
      this.logger.log('Resend cliente inicializado.');
      return;
    }

    // Fallback: SMTP via nodemailer.
    if (this.smtpUser && this.smtpPass) {
      await this.initSmtp();
      return;
    }

    this.logger.warn('Nenhum provider de e-mail configurado (RESEND_API_KEY nem SMTP_USER/SMTP_PASS). Envios serão ignorados.');
  }

  private async initSmtp() {
    const hostFromEnv = process.env.SMTP_HOST || 'smtp.gmail.com';
    let resolvedHost = hostFromEnv;
    try {
      const { address } = await dnsLookup(hostFromEnv, { family: 4 });
      resolvedHost = address;
    } catch {
      // segue com hostname original
    }

    const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
    const secure = process.env.SMTP_SECURE === 'true' ? true : port === 465;

    this.transporter = nodemailer.createTransport({
      host: resolvedHost,
      port,
      secure,
      requireTLS: !secure,
      auth: { user: this.smtpUser!, pass: this.smtpPass!.replace(/\s+/g, '') },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
      tls: { servername: hostFromEnv },
    });

    this.logger.log(`SMTP transporter pronto: host=${resolvedHost} port=${port}`);
    try {
      await this.transporter.verify();
      this.logger.log('SMTP transporter verificado com sucesso.');
    } catch (err: any) {
      this.logger.error(`Falha ao verificar SMTP: ${err?.message ?? err}`);
    }
  }

  async sendWelcomeMorador(email: string, nome: string, senhaInicial: string): Promise<void> {
    const subject = 'PRESTARE - Bem-vindo(a)! Suas credenciais de acesso';
    const text = `Olá, ${nome}!\n\nO seu acesso ao aplicativo PRESTARE foi criado com sucesso.\nPara acessar sua conta como Morador, baixe o aplicativo e utilize as credenciais abaixo:\n\nLogin (E-mail): ${email}\nSenha Inicial: ${senhaInicial}\n\nRecomendamos que você altere sua senha após o primeiro acesso no menu de Configurações do App.\n\nEquipe PRESTARE Condomínios\nhttps://www.clickprestarecondominios.com.br`;
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${this.escape(subject)}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px 10px;">
        <div style="display:none;font-size:1px;color:#fff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
          Suas credenciais de acesso ao aplicativo PRESTARE
        </div>
        <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #0f172a; margin: 0; font-size: 20px; font-weight: 700;">Credenciais de Acesso</h2>
          </div>
          <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
            Olá, <b>${this.escape(nome)}</b>!<br><br>
            O seu acesso ao aplicativo <b>PRESTARE</b> foi criado com sucesso.<br><br>
            Para acessar sua conta como <b>Morador</b>, baixe o aplicativo e utilize as credenciais abaixo:
          </p>

          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 20px 0;">
            <div style="margin-bottom: 14px;">
              <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Login (E-mail):</span>
              <div style="font-size: 14px; color: #0f172a; font-weight: 600; margin-top: 4px; word-break: break-all;">
                ${this.escape(email)}
              </div>
            </div>
            <div>
              <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Senha Inicial:</span>
              <div style="text-align: center; margin: 12px 0 6px 0;">
                <span style="display: inline-block; font-size: 28px; font-weight: 800; letter-spacing: 4px; color: #1e3a8a; background-color: #ffffff; padding: 12px 28px; border-radius: 8px; border: 1px dashed #94a3b8; font-family: monospace;">
                  ${this.escape(senhaInicial)}
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
      </body>
      </html>
    `;
    await this.send(email, subject, html, text);
  }

  async sendWelcomeMoradorExisting(email: string, nome: string): Promise<void> {
    const subject = 'PRESTARE - Bem-vindo(a)! Novo vínculo de condomínio';
    const text = `Olá, ${nome}!\n\nO seu acesso ao aplicativo PRESTARE foi vinculado a um novo condomínio com sucesso.\nComo você já possui um cadastro ativo no sistema associado a este e-mail (${email}), utilize a sua senha cadastrada anteriormente para acessar.\n\nSe você não se lembra da sua senha atual, basta abrir o aplicativo e tocar em "Esqueci minha senha" na tela de login para redefini-la.\n\nEquipe PRESTARE Condomínios\nhttps://www.clickprestarecondominios.com.br`;
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${this.escape(subject)}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px 10px;">
        <div style="display:none;font-size:1px;color:#fff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
          Novo vínculo de condomínio no aplicativo PRESTARE
        </div>
        <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #0f172a; margin: 0; font-size: 20px; font-weight: 700;">Novo Vínculo de Unidade</h2>
          </div>
          <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
            Olá, <b>${this.escape(nome)}</b>!<br><br>
            O seu acesso ao aplicativo <b>PRESTARE</b> foi vinculado a um novo apartamento/condomínio com sucesso.<br><br>
            Como você já possui um cadastro ativo associado ao e-mail <b>${this.escape(email)}</b>, utilize a sua <b>senha já cadastrada anteriormente</b> para acessar sua conta.
          </p>

          <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px 18px; margin: 20px 0;">
            <p style="color: #1e40af; font-size: 13px; line-height: 1.5; margin: 0;">
              💡 <b>Esqueceu sua senha?</b> Basta abrir o aplicativo PRESTARE e clicar em <b>"Esqueci minha senha"</b> na tela de login para redefini-la a qualquer momento.
            </p>
          </div>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">
            Equipe PRESTARE Condomínios
          </p>
        </div>
      </body>
      </html>
    `;
    await this.send(email, subject, html, text);
  }

  async sendForgotPassword(email: string, novaSenha: string, tipoUsuario: string): Promise<void> {
    const subject = 'PRESTARE - Recuperação de Senha';
    const text = `Olá!\n\nVocê ou alguém solicitou a recuperação de senha do aplicativo PRESTARE.\n\nUtilize a senha temporária abaixo para entrar na sua conta como ${tipoUsuario}:\n${novaSenha}\n\nPor segurança, altere sua senha no menu de Configurações logo após o login.\n\nEquipe PRESTARE Condomínios\nhttps://www.clickprestarecondominios.com.br`;
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${this.escape(subject)}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px 10px;">
        <div style="display:none;font-size:1px;color:#fff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
          Recuperação de senha do aplicativo PRESTARE
        </div>
        <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #0f172a; margin: 0; font-size: 20px; font-weight: 700;">Recuperação de Senha</h2>
          </div>
          <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
            Olá!<br><br>
            Você ou alguém solicitou a recuperação de senha da sua conta no aplicativo <b>PRESTARE</b>.<br><br>
            Utilize a nova senha temporária abaixo para entrar na sua conta como <b>${this.escape(tipoUsuario)}</b>:
          </p>

          <div style="text-align: center; margin: 24px 0;">
            <span style="display: inline-block; font-size: 28px; font-weight: 800; letter-spacing: 4px; color: #1e3a8a; background-color: #f1f5f9; padding: 12px 28px; border-radius: 8px; border: 1px dashed #94a3b8; font-family: monospace;">
              ${this.escape(novaSenha)}
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
      </body>
      </html>
    `;
    await this.send(email, subject, html, text);
  }

  async sendResetPasswordLink(email: string, token: string, tipoUsuario: string): Promise<void> {
    const webLink = `https://www.clickprestarecondominios.com.br/redefinir-senha?token=${encodeURIComponent(token)}`;
    const deepLink = `clickprestare://redefinir-senha?token=${encodeURIComponent(token)}`;
    const subject = 'PRESTARE - Recuperação de Senha';
    const text = `Olá!\n\nVocê solicitou a redefinição de senha da sua conta (${tipoUsuario}) no sistema PRESTARE.\n\nPara cadastrar uma nova senha, acesse o link abaixo:\n${webLink}\n\nSe estiver no celular com o aplicativo PRESTARE instalado, você também pode abrir diretamente:\n${deepLink}\n\nEste link é válido por 30 minutos e só pode ser utilizado uma vez.\nSe você não solicitou a redefinição de senha, ignore esta mensagem: sua conta continua segura.\n\nEquipe PRESTARE Condomínios\nhttps://www.clickprestarecondominios.com.br`;
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${this.escape(subject)}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px 10px;">
        <div style="display:none;font-size:1px;color:#fff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
          Link para redefinição de senha no sistema PRESTARE
        </div>
        <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #0f172a; margin: 0; font-size: 20px; font-weight: 700;">Redefinição de Senha</h2>
          </div>
          <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
            Olá!<br><br>
            Recebemos uma solicitação para redefinir a senha da sua conta de <b>${this.escape(tipoUsuario)}</b> no sistema <b>PRESTARE</b>.<br><br>
            Para criar sua nova senha, clique no botão seguro abaixo:
          </p>

          <div style="text-align: center; margin: 28px 0;">
            <a href="${webLink}" style="display: inline-block; background-color: #1e3a8a; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 2px 4px rgba(30, 58, 138, 0.25);">
              Redefinir Minha Senha
            </a>
          </div>

          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin: 20px 0;">
            <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin: 0; word-break: break-all;">
              Se o botão não funcionar, copie e cole este link no seu navegador:<br>
              <a href="${webLink}" style="color: #2563eb; font-family: monospace;">${webLink}</a>
            </p>
          </div>

          <div style="text-align: center; margin: 16px 0;">
            <a href="${deepLink}" style="color: #64748b; font-size: 12px; text-decoration: underline;">
              Prefere abrir diretamente no aplicativo PRESTARE instalado? Clique aqui
            </a>
          </div>

          <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0 0 20px 0;">
            ⏳ <i>Este link expira em <b>30 minutos</b> e só pode ser usado uma única vez.</i><br>
            🔒 <i>Se você não realizou essa solicitação, desconsidere este e-mail. Sua senha atual permanece inalterada.</i>
          </p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">
            Equipe PRESTARE Condomínios
          </p>
        </div>
      </body>
      </html>
    `;
    await this.send(email, subject, html, text);
  }

  async sendBillingReminder(
    email: string,
    nome: string,
    descricao: string,
    vencimento: string,
    valor: string,
    copiacola?: string,
  ): Promise<void> {
    const subject = `Lembrete de Cobrança: ${descricao}`;
    const text = `Olá, ${nome}!\n\nEste é um aviso automático sobre a seguinte cobrança pendente:\n\nDescrição: ${descricao}\nValor: ${valor}\nVencimento: ${vencimento}\n\n${copiacola ? `Chave Pix Copia e Cola:\n${copiacola}\n\n` : ''}Regularize sua situação pelo aplicativo PRESTARE.\n\nEquipe PRESTARE Condomínios\nhttps://www.clickprestarecondominios.com.br`;
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${this.escape(subject)}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px 10px;">
        <div style="display:none;font-size:1px;color:#fff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
          Lembrete de cobrança pendente PRESTARE
        </div>
        <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #0f172a; margin: 0; font-size: 20px; font-weight: 700;">Lembrete de Cobrança</h2>
          </div>
          <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
            Olá, <b>${this.escape(nome)}</b>!<br><br>
            Este é um aviso automático sobre a seguinte cobrança pendente:
          </p>

          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <div style="margin-bottom: 10px;">
              <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600;">Descrição:</span>
              <div style="font-size: 14px; color: #0f172a; font-weight: 600; margin-top: 2px;">${this.escape(descricao)}</div>
            </div>
            <div style="margin-bottom: 10px;">
              <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600;">Valor:</span>
              <div style="font-size: 16px; color: #1e3a8a; font-weight: 700; margin-top: 2px;">${this.escape(valor)}</div>
            </div>
            <div>
              <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600;">Vencimento:</span>
              <div style="font-size: 14px; color: #b91c1c; font-weight: 600; margin-top: 2px;">${this.escape(vencimento)}</div>
            </div>
            ${copiacola ? `
            <div style="margin-top: 14px; border-top: 1px solid #e2e8f0; padding-top: 12px;">
              <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600;">Chave Pix Copia e Cola:</span>
              <pre style="background: #ffffff; border: 1px solid #cbd5e1; padding: 10px; border-radius: 6px; word-break: break-all; font-size: 11px; color: #334155; margin-top: 6px; white-space: pre-wrap;">${this.escape(copiacola)}</pre>
            </div>` : ''}
          </div>

          <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0 0 20px 0;">
            Regularize sua situação financeira diretamente pelo aplicativo <b>PRESTARE</b>.
          </p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">
            Equipe PRESTARE Condomínios
          </p>
        </div>
      </body>
      </html>
    `;
    await this.send(email, subject, html, text);
  }

  async sendMfaCode(email: string, nome: string, code: string): Promise<void> {
    const subject = `Código de verificação: ${code} - PRESTARE`;
    const text = `Olá, ${nome}!\n\nRecebemos uma solicitação de login no aplicativo PRESTARE Síndico.\n\nSeu código de segurança de 6 dígitos é: ${code}\n\nEste código é válido por 10 minutos.\nSe você não solicitou este acesso, sua senha pode estar comprometida. Altere sua senha imediatamente no aplicativo ou contate o suporte.\n\nEquipe PRESTARE Condomínios\nhttps://www.clickprestarecondominios.com.br`;
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${this.escape(subject)}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px 10px;">
        <div style="display:none;font-size:1px;color:#fff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
          Seu código de acesso PRESTARE é ${this.escape(code)}
        </div>
        <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #0f172a; margin: 0; font-size: 20px; font-weight: 700;">Autenticação em Duas Etapas</h2>
          </div>
          <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
            Olá, <b>${this.escape(nome)}</b>!<br><br>
            Recebemos uma solicitação de login no aplicativo <b>PRESTARE Síndico</b>. Utilize o código de 6 dígitos abaixo para confirmar seu acesso:
          </p>
          <div style="text-align: center; margin: 24px 0;">
            <span style="display: inline-block; font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #1e3a8a; background-color: #f1f5f9; padding: 14px 28px; border-radius: 8px; border: 1px dashed #94a3b8; font-family: monospace;">
              ${this.escape(code)}
            </span>
          </div>
          <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0 0 20px 0;">
            ⏳ Este código é válido por <b>10 minutos</b>.<br>
            ⚠️ Se você não solicitou este acesso, sua conta pode estar sob tentativa de invasão. Altere sua senha imediatamente.
          </p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">
            Equipe PRESTARE Condomínios
          </p>
        </div>
      </body>
      </html>
    `;
    await this.send(email, subject, html, text);
  }

  private async send(to: string, subject: string, html: string, text?: string): Promise<void> {
    const htmlComRodape = `${html}${this.getEmailFooter()}`;
    const textContent =
      text ||
      html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const headers = {
      'X-Priority': '1 (Highest)',
      'X-MSMail-Priority': 'High',
      Importance: 'High',
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'OOF, AutoReply',
      'X-Mailer': 'Prestare-Security-Mailer',
    };

    if (this.resend) {
      try {
        const { data, error } = await this.resend.emails.send({
          from: this.fromAddress,
          replyTo: this.fromAddress,
          to: [to],
          subject,
          html: htmlComRodape,
          text: textContent,
          headers,
        });
        if (error) {
          this.logger.error(`Falha Resend para ${to}: ${error.name ?? ''} ${error.message ?? error}`);
          throw new Error(error.message ?? 'Resend error');
        }
        this.logger.log(`E-mail enviado via Resend para ${to}. id=${data?.id}`);
      } catch (err: any) {
        this.logger.error(`Erro no envio Resend para ${to}: ${err?.message ?? err}`);
        throw err;
      }
      return;
    }

    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: this.fromAddress,
          replyTo: this.fromAddress,
          to,
          subject,
          text: textContent,
          html: htmlComRodape,
          headers,
        });
        this.logger.log(`E-mail enviado via SMTP para ${to}. messageId=${info.messageId}`);
      } catch (err: any) {
        this.logger.error(`Erro no envio SMTP para ${to}: ${err?.message ?? err}`);
        throw err;
      }
      return;
    }

    this.logger.error(
      `Tentativa de envio de e-mail para ${to} rejeitada: nenhum serviço de e-mail (Resend ou SMTP) está configurado no servidor.`,
    );
    throw new ServiceUnavailableException(
      'Serviço de envio de e-mail não configurado no servidor.',
    );
  }

  async getHealth(): Promise<{ configured: boolean; provider: string; from: string; error?: string }> {
    if (this.resend) {
      return { configured: true, provider: 'resend', from: this.fromAddress };
    }
    if (this.transporter) {
      try {
        await this.transporter.verify();
        return { configured: true, provider: 'smtp', from: this.fromAddress };
      } catch (err: any) {
        return { configured: false, provider: 'smtp', from: this.fromAddress, error: err?.message ?? String(err) };
      }
    }
    return { configured: false, provider: 'none', from: this.fromAddress, error: 'Nenhum provedor configurado' };
  }

  private getEmailFooter(): string {
    return `
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
  }

  private escape(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
