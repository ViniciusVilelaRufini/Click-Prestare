import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Resend } from 'resend';
import * as nodemailer from 'nodemailer';
import * as dns from 'dns';
import { promisify } from 'util';

dns.setDefaultResultOrder('ipv4first');
const dnsLookup = promisify(dns.lookup);

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
    this.resendKey = process.env.RESEND_API_KEY;
    this.smtpUser = process.env.SMTP_USER;
    this.smtpPass = process.env.SMTP_PASS;

    const fromEmail = process.env.MAIL_FROM
      || process.env.SMTP_FROM
      || this.smtpUser
      || 'onboarding@resend.dev';
    const fromName = process.env.MAIL_FROM_NAME
      || process.env.SMTP_FROM_NAME
      || 'Prestare Condomínios';
    this.fromAddress = `${fromName} <${fromEmail}>`;

    this.logger.log(`MailService construido. Resend=${!!this.resendKey} SMTP=${!!(this.smtpUser && this.smtpPass)} from=${this.fromAddress}`);
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
    const html = `
      Olá, <b>${this.escape(nome)}</b>!<br><br>
      O seu acesso ao aplicativo <b>PRESTARE</b> foi criado com sucesso.<br><br>
      Para acessar sua conta como <b>Morador</b>, baixe o aplicativo e utilize as credenciais abaixo:<br><br>
      <b>Login (E-mail):</b> ${this.escape(email)}<br>
      <b>Senha Inicial:</b> ${this.escape(senhaInicial)}<br><br>
      <i>Recomendamos que você altere sua senha após o primeiro acesso no menu de Configurações do App.</i><br><br>
      Seja muito bem-vindo(a)!<br>
      Equipe PRESTARE
    `;
    await this.send(email, subject, html);
  }

  async sendWelcomeMoradorExisting(email: string, nome: string): Promise<void> {
    const subject = 'PRESTARE - Bem-vindo(a)! Novo vínculo de condomínio';
    const html = `
      Olá, <b>${this.escape(nome)}</b>!<br><br>
      O seu acesso ao aplicativo <b>PRESTARE</b> foi vinculado a um novo apartamento com sucesso.<br><br>
      Como você já possui um cadastro ativo no sistema associado a este e-mail, **utilize a sua senha cadastrada anteriormente** para acessar a sua conta.<br><br>
      Se você não se lembra da sua senha atual, basta abrir o aplicativo e tocar em **"Esqueci minha senha"** na tela de login para redefini-la.<br><br>
      Seja muito bem-vindo(a)!<br>
      Equipe PRESTARE
    `;
    await this.send(email, subject, html);
  }

  async sendForgotPassword(email: string, novaSenha: string, tipoUsuario: string): Promise<void> {
    const subject = 'PRESTARE - Recuperação de Senha';
    const html = `
      Olá,<br><br>
      Você ou alguém solicitou a recuperação de senha do App PRESTARE.<br><br>
      Utilize a senha abaixo para entrar na sua conta como ${this.escape(tipoUsuario)}:<br>
      <b>${this.escape(novaSenha)}</b><br><br>
      Atenciosamente,<br>
      Equipe PRESTARE
    `;
    await this.send(email, subject, html);
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
    const html = `
      Olá, <b>${this.escape(nome)}</b>!<br><br>
      Este é um aviso automático sobre a seguinte cobrança pendente:<br><br>
      <b>Descrição:</b> ${this.escape(descricao)}<br>
      <b>Valor:</b> ${this.escape(valor)}<br>
      <b>Vencimento:</b> ${this.escape(vencimento)}<br><br>
      ${copiacola ? `Você pode efetuar o pagamento diretamente usando a chave Pix Copia e Cola abaixo:<br><br><pre style="background: #f4f4f4; padding: 10px; border-radius: 5px; word-break: break-all;">${this.escape(copiacola)}</pre><br><br>` : ''}
      Regularize sua situação financeira pelo aplicativo PRESTARE.<br><br>
      Atenciosamente,<br>
      Equipe PRESTARE
    `;
    await this.send(email, subject, html);
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    const htmlComRodape = `${html}${this.getEmailFooter()}`;

    if (this.resend) {
      try {
        const { data, error } = await this.resend.emails.send({
          from: this.fromAddress,
          to: [to],
          subject,
          html: htmlComRodape,
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
        const info = await this.transporter.sendMail({ from: this.fromAddress, to, subject, html: htmlComRodape });
        this.logger.log(`E-mail enviado via SMTP para ${to}. messageId=${info.messageId}`);
      } catch (err: any) {
        this.logger.error(`Erro no envio SMTP para ${to}: ${err?.message ?? err}`);
        throw err;
      }
      return;
    }

    this.logger.warn(`E-mail para ${to} ignorado (nenhum provider configurado).`);
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
