import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Resend } from 'resend';
import * as nodemailer from 'nodemailer';
import * as dns from 'dns';
import { promisify } from 'util';
import { limiteExterno } from '../limitar-concorrencia';
import { botao, caixaCodigo, esc, forte, layoutEmail, linkSecundario, nota, painelDados, paragrafo, urlCopiavel } from './mail-layout';

/**
 * Bulkhead do envio de e-mail (SMTP ou Resend): máx. 4 envios simultâneos por
 * instância (LIMITES_EXTERNOS.smtp). Um SMTP pendurado não acumula conexões.
 */
const limitarEmail = limiteExterno('smtp');

dns.setDefaultResultOrder('ipv4first');
const dnsLookup = promisify(dns.lookup);

/** Conta do Workspace que autentica no SMTP. */
const OFFICIAL_EMAIL = 'suporte@clickprestarecondominios.com.br';
/** Remetente exibido: alias da mesma conta no domínio novo ("enviar como" no Gmail). */
const OFFICIAL_FROM = 'suporte@prestarecondominios.com.br';
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

    // Credenciais só do ambiente (Elastic Beanstalk): SMTP_USER + SMTP_PASS (senha de app do Workspace).
    this.smtpUser = clean(process.env.SMTP_USER) || OFFICIAL_EMAIL;
    this.smtpPass = clean(process.env.SMTP_PASS)?.replace(/\s+/g, '');
    if (this.smtpUser.toLowerCase().includes('viniciusrufini')) {
      this.logger.error(`SMTP_USER aponta para conta pessoal (${this.smtpUser}); configure a conta oficial no ambiente.`);
    }

    let fromEmail = clean(process.env.MAIL_FROM) || clean(process.env.SMTP_FROM) || OFFICIAL_FROM;

    if (fromEmail.toLowerCase().includes('viniciusrufini') || fromEmail === 'onboarding@resend.dev') {
      fromEmail = OFFICIAL_FROM;
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
    const text = `Olá, ${nome}!\n\nO seu acesso ao aplicativo PRESTARE foi criado com sucesso.\nPara acessar sua conta como Morador, baixe o aplicativo e utilize as credenciais abaixo:\n\nLogin (E-mail): ${email}\nSenha Inicial: ${senhaInicial}\n\nRecomendamos que você altere sua senha após o primeiro acesso no menu de Configurações do App.\n\nEquipe PRESTARE Condomínios\nhttps://www.prestarecondominios.com.br`;
    const html = layoutEmail({
      assunto: subject,
      preheader: 'Suas credenciais de acesso ao aplicativo PRESTARE',
      eyebrow: 'Boas-vindas',
      titulo: 'Credenciais de acesso',
      corpo: `
        ${paragrafo(`Olá, ${forte(esc(nome))}!`)}
        ${paragrafo(`O seu acesso ao aplicativo ${forte('PRESTARE')} foi criado. Para entrar como ${forte('Morador')}, baixe o aplicativo e use as credenciais abaixo:`)}
        ${painelDados([{ label: 'Login (e-mail)', valor: esc(email) }])}
        ${caixaCodigo('Senha inicial', senhaInicial)}
        ${nota('Recomendamos trocar a senha depois do primeiro acesso, no menu Configurações do aplicativo.')}
      `,
    });
    await this.send(email, subject, html, text);
  }

  async sendWelcomeMoradorExisting(email: string, nome: string): Promise<void> {
    const subject = 'PRESTARE - Bem-vindo(a)! Novo vínculo de condomínio';
    const text = `Olá, ${nome}!\n\nO seu acesso ao aplicativo PRESTARE foi vinculado a um novo condomínio com sucesso.\nComo você já possui um cadastro ativo no sistema associado a este e-mail (${email}), utilize a sua senha cadastrada anteriormente para acessar.\n\nSe você não se lembra da sua senha atual, basta abrir o aplicativo e tocar em "Esqueci minha senha" na tela de login para redefini-la.\n\nEquipe PRESTARE Condomínios\nhttps://www.prestarecondominios.com.br`;
    const html = layoutEmail({
      assunto: subject,
      preheader: 'Novo vínculo de condomínio no aplicativo PRESTARE',
      eyebrow: 'Boas-vindas',
      titulo: 'Novo vínculo de unidade',
      corpo: `
        ${paragrafo(`Olá, ${forte(esc(nome))}!`)}
        ${paragrafo(`O seu acesso ao aplicativo ${forte('PRESTARE')} foi vinculado a um novo apartamento/condomínio.`)}
        ${paragrafo(`Como você já tem um cadastro ativo com o e-mail ${forte(esc(email))}, use a ${forte('senha que já cadastrou')} para entrar.`)}
        ${nota(`${forte('Esqueceu a senha?')} Abra o aplicativo PRESTARE e toque em ${forte('Esqueci minha senha')} na tela de login para redefini-la.`)}
      `,
    });
    await this.send(email, subject, html, text);
  }

  async sendForgotPassword(email: string, novaSenha: string, tipoUsuario: string): Promise<void> {
    const subject = 'PRESTARE - Recuperação de Senha';
    const text = `Olá!\n\nVocê ou alguém solicitou a recuperação de senha do aplicativo PRESTARE.\n\nUtilize a senha temporária abaixo para entrar na sua conta como ${tipoUsuario}:\n${novaSenha}\n\nPor segurança, altere sua senha no menu de Configurações logo após o login.\n\nEquipe PRESTARE Condomínios\nhttps://www.prestarecondominios.com.br`;
    const html = layoutEmail({
      assunto: subject,
      preheader: 'Recuperação de senha do aplicativo PRESTARE',
      eyebrow: 'Segurança da conta',
      titulo: 'Recuperação de senha',
      corpo: `
        ${paragrafo('Olá!')}
        ${paragrafo(`Você ou alguém pediu a recuperação de senha da sua conta no aplicativo ${forte('PRESTARE')}. Use a senha temporária abaixo para entrar como ${forte(esc(tipoUsuario))}:`)}
        ${caixaCodigo('Senha temporária', novaSenha)}
        ${nota('Por segurança, troque a senha nas configurações do aplicativo logo depois de entrar.', 'alerta')}
      `,
    });
    await this.send(email, subject, html, text);
  }

  async sendResetPasswordLink(email: string, token: string, tipoUsuario: string): Promise<void> {
    const webLink = `https://www.prestarecondominios.com.br/?redefinir-senha=${encodeURIComponent(token)}`;
    const deepLink = `clickprestare://redefinir-senha?token=${encodeURIComponent(token)}`;
    const subject = 'PRESTARE - Recuperação de Senha';
    const text = `Olá!\n\nVocê solicitou a redefinição de senha da sua conta (${tipoUsuario}) no sistema PRESTARE.\n\nPara cadastrar uma nova senha, acesse o link abaixo:\n${webLink}\n\nSe estiver no celular com o aplicativo PRESTARE instalado, você também pode abrir diretamente:\n${deepLink}\n\nEste link é válido por 30 minutos e só pode ser utilizado uma vez.\nSe você não solicitou a redefinição de senha, ignore esta mensagem: sua conta continua segura.\n\nEquipe PRESTARE Condomínios\nhttps://www.prestarecondominios.com.br`;
    const html = layoutEmail({
      assunto: subject,
      preheader: 'Link para redefinição de senha no sistema PRESTARE',
      eyebrow: 'Segurança da conta',
      titulo: 'Redefinição de senha',
      corpo: `
        ${paragrafo('Olá!')}
        ${paragrafo(`Recebemos um pedido para redefinir a senha da sua conta de ${forte(esc(tipoUsuario))} no sistema ${forte('PRESTARE')}. Para criar a nova senha, use o botão abaixo:`)}
        ${botao(webLink, 'Redefinir minha senha')}
        ${urlCopiavel('Se o botão não funcionar, copie e cole este link no navegador:', webLink)}
        ${linkSecundario(deepLink, 'Prefere abrir direto no aplicativo PRESTARE instalado? Toque aqui')}
        ${nota(`Este link vale por ${forte('30 minutos')} e só pode ser usado uma vez.`)}
        ${nota('Se você não fez esse pedido, ignore este e-mail. Sua senha atual continua a mesma.')}
      `,
    });
    await this.send(email, subject, html, text);
  }

  async sendResetPasswordCode(
    email: string,
    nome: string,
    code: string,
    tipoUsuario = 'Usuário',
  ): Promise<void> {
    const subject = `Código para redefinição de senha: ${code} - PRESTARE`;
    const text = `Olá, ${nome}!\n\nRecebemos uma solicitação para redefinir a senha da sua conta (${tipoUsuario}) no aplicativo PRESTARE.\n\nSeu código de segurança de 6 dígitos é: ${code}\n\nDigite este código diretamente no aplicativo para cadastrar sua nova senha.\nEste código é válido por 10 minutos.\nSe você não solicitou a redefinição de senha, desconsidere esta mensagem: sua conta continua segura.\n\nEquipe PRESTARE Condomínios\nhttps://www.prestarecondominios.com.br`;
    const html = layoutEmail({
      assunto: subject,
      preheader: `Seu código de recuperação PRESTARE é ${code}`,
      eyebrow: 'Segurança da conta',
      titulo: 'Recuperação de senha',
      corpo: `
        ${paragrafo(`Olá, ${forte(esc(nome))}!`)}
        ${paragrafo(`Recebemos um pedido para redefinir a senha da sua conta de ${forte(esc(tipoUsuario))} no aplicativo ${forte('PRESTARE')}. Digite o código abaixo no aplicativo para criar a nova senha:`)}
        ${caixaCodigo('Código de 6 dígitos', code)}
        ${nota(`Este código vale por ${forte('10 minutos')} e só pode ser usado uma vez.`)}
        ${nota('Se você não fez esse pedido, ignore este e-mail. Sua senha atual continua a mesma.')}
      `,
    });
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
    const text = `Olá, ${nome}!\n\nEste é um aviso automático sobre a seguinte cobrança pendente:\n\nDescrição: ${descricao}\nValor: ${valor}\nVencimento: ${vencimento}\n\n${copiacola ? `Chave Pix Copia e Cola:\n${copiacola}\n\n` : ''}Regularize sua situação pelo aplicativo PRESTARE.\n\nEquipe PRESTARE Condomínios\nhttps://www.prestarecondominios.com.br`;
    const linhas: Parameters<typeof painelDados>[0] = [
      { label: 'Descrição', valor: esc(descricao) },
      { label: 'Valor', valor: esc(valor), grande: true },
      { label: 'Vencimento', valor: esc(vencimento), cor: '#ff6b6b' },
    ];
    if (copiacola) linhas.push({ label: 'Pix copia e cola', valor: esc(copiacola), mono: true });
    const html = layoutEmail({
      assunto: subject,
      preheader: 'Lembrete de cobrança pendente PRESTARE',
      eyebrow: 'Financeiro',
      titulo: 'Lembrete de cobrança',
      corpo: `
        ${paragrafo(`Olá, ${forte(esc(nome))}!`)}
        ${paragrafo('Este é um aviso automático sobre a cobrança pendente abaixo:')}
        ${painelDados(linhas)}
        ${paragrafo(`Regularize pelo aplicativo ${forte('PRESTARE')}.`)}
      `,
    });
    await this.send(email, subject, html, text);
  }

  async sendMfaCode(email: string, nome: string, code: string): Promise<void> {
    const subject = `Código de verificação: ${code} - PRESTARE`;
    const text = `Olá, ${nome}!\n\nRecebemos uma solicitação de login no aplicativo PRESTARE Síndico.\n\nSeu código de segurança de 6 dígitos é: ${code}\n\nEste código é válido por 10 minutos.\nSe você não solicitou este acesso, sua senha pode estar comprometida. Altere sua senha imediatamente no aplicativo ou contate o suporte.\n\nEquipe PRESTARE Condomínios\nhttps://www.prestarecondominios.com.br`;
    const html = layoutEmail({
      assunto: subject,
      preheader: `Seu código de acesso PRESTARE é ${code}`,
      eyebrow: 'Segurança da conta',
      titulo: 'Autenticação em duas etapas',
      corpo: `
        ${paragrafo(`Olá, ${forte(esc(nome))}!`)}
        ${paragrafo(`Recebemos um pedido de login no aplicativo ${forte('PRESTARE Síndico')}. Use o código abaixo para confirmar o acesso:`)}
        ${caixaCodigo('Código de verificação', code)}
        ${nota(`Este código vale por ${forte('10 minutos')}.`)}
        ${nota(`${forte('Não foi você?')} Alguém pode estar tentando entrar na sua conta. Troque sua senha imediatamente.`, 'alerta')}
      `,
    });
    await this.send(email, subject, html, text);
  }

  private async send(to: string, subject: string, html: string, text?: string): Promise<void> {
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
        const resend = this.resend;
        const { data, error } = await limitarEmail(() =>
          resend.emails.send({
            from: this.fromAddress,
            replyTo: this.fromAddress,
            to: [to],
            subject,
            html,
            text: textContent,
            headers,
          }),
        );
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
        const transporter = this.transporter;
        const info = await limitarEmail(() =>
          transporter.sendMail({
            from: this.fromAddress,
            replyTo: this.fromAddress,
            to,
            subject,
            text: textContent,
            html,
            headers,
          }),
        );
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

}
