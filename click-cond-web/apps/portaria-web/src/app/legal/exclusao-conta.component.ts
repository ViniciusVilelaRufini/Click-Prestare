import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-exclusao-conta',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="min-h-screen bg-slate-950 text-slate-300 py-12 px-4 sm:px-6 lg:px-8 selection:bg-emerald-500 selection:text-slate-950">
      <div class="max-w-4xl mx-auto space-y-8">
        
        <!-- Cabeçalho -->
        <div class="text-center space-y-3 border-b border-white/10 pb-8">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
            Google Play & LGPD Compliance · Exclusão de Conta
          </div>
          <h1 class="text-3xl font-extrabold text-white tracking-tight sm:text-4xl">Exclusão de Conta e Dados Pessoais</h1>
          <p class="text-sm text-slate-400">Aplicativo: Click Condomínios / Prestare Gestão (ID: br.com.clickprestare.app)</p>
        </div>

        <!-- Conteúdo Legal -->
        <div class="space-y-6 text-sm leading-relaxed">
          <section class="space-y-3">
            <h2 class="text-base font-bold text-white uppercase tracking-wide border-l-2 border-emerald-400 pl-3">1. Visão Geral</h2>
            <p>
              Em conformidade com a <strong>Política de Dados do Usuário do Google Play</strong> e a <strong>Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018)</strong>, a plataforma <strong>Click Condomínios / Prestare Gestão</strong> assegura a todos os seus usuários (moradores, síndicos, funcionários e visitantes) o direito de solicitar a exclusão de sua conta e a eliminação dos respectivos dados pessoais armazenados em nossos sistemas.
            </p>
            <p>
              Você não precisa manter o aplicativo instalado para solicitar a exclusão: disponibilizamos tanto o fluxo automatizado dentro do app quanto um canal web direto e público via e-mail oficial.
            </p>
          </section>

          <section class="space-y-3">
            <h2 class="text-base font-bold text-white uppercase tracking-wide border-l-2 border-emerald-400 pl-3">2. Como Solicitar a Exclusão Diretamente pelo Aplicativo</h2>
            <p>Se você possui acesso ao aplicativo em seu smartphone (Android ou iPhone):</p>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div class="p-4 rounded-xl bg-slate-900 border border-white/10 space-y-1">
                <span class="text-emerald-400 font-bold text-lg">Passo 1</span>
                <p class="font-semibold text-white text-xs">Acesse sua Conta</p>
                <p class="text-xs text-slate-400">Faça o login usual no app com seu e-mail, CPF ou Face ID.</p>
              </div>
              <div class="p-4 rounded-xl bg-slate-900 border border-white/10 space-y-1">
                <span class="text-emerald-400 font-bold text-lg">Passo 2</span>
                <p class="font-semibold text-white text-xs">Vá em Configurações</p>
                <p class="text-xs text-slate-400">Toque no menu lateral ou no seu perfil e selecione "Configurações".</p>
              </div>
              <div class="p-4 rounded-xl bg-slate-900 border border-white/10 space-y-1">
                <span class="text-emerald-400 font-bold text-lg">Passo 3</span>
                <p class="font-semibold text-white text-xs">Excluir Minha Conta</p>
                <p class="text-xs text-slate-400">Toque em "Excluir Minha Conta" no rodapé e confirme a solicitação.</p>
              </div>
            </div>
          </section>

          <section class="space-y-3">
            <h2 class="text-base font-bold text-white uppercase tracking-wide border-l-2 border-emerald-400 pl-3">3. Como Solicitar a Exclusão via Web (Sem Necessidade do App)</h2>
            <p>
              Caso você não tenha mais o aplicativo instalado, tenha perdido o acesso ao dispositivo ou prefira atendimento direto, você pode solicitar a exclusão total da conta e dos dados pessoais diretamente ao nosso <strong>Encarregado de Proteção de Dados (DPO)</strong>:
            </p>
            <div class="p-4 rounded-xl bg-slate-900 border border-emerald-500/20 space-y-2">
              <p class="font-semibold text-emerald-400 text-xs uppercase tracking-wider">Canal Oficial de Exclusão:</p>
              <p class="text-xs text-slate-300">
                Envie um e-mail para: <a href="mailto:suporte@clickprestarecondominios.com.br" class="text-emerald-400 underline font-semibold">suporte&#64;clickprestarecondominios.com.br</a>
              </p>
              <p class="text-xs text-slate-400">
                <strong>Assunto:</strong> Solicitação de Exclusão de Conta — [Seu Nome Completo]<br />
                <strong>Informações necessárias no corpo da mensagem:</strong> Nome completo, e-mail cadastrado, CPF do titular e nome do condomínio.
              </p>
            </div>
          </section>

          <section class="space-y-3">
            <h2 class="text-base font-bold text-white uppercase tracking-wide border-l-2 border-emerald-400 pl-3">4. Quais Dados São Excluídos e Quais São Retidos</h2>
            <div class="overflow-x-auto">
              <table class="w-full text-xs text-left border border-white/10 rounded-lg overflow-hidden">
                <thead class="bg-slate-900 text-white font-semibold">
                  <tr>
                    <th class="p-3 border-b border-white/10">Categoria de Dados</th>
                    <th class="p-3 border-b border-white/10">Tratamento Após a Exclusão</th>
                    <th class="p-3 border-b border-white/10">Base Legal / Justificativa</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-white/5">
                  <tr>
                    <td class="p-3 font-medium text-white">Credenciais e Autenticação (Login, senha, tokens)</td>
                    <td class="p-3 text-emerald-400 font-semibold">Exclusão Imediata e definitiva</td>
                    <td class="p-3 text-slate-400">Art. 15 e 16 da LGPD (Término do tratamento).</td>
                  </tr>
                  <tr>
                    <td class="p-3 font-medium text-white">Biometria Facial (Fotos e templates)</td>
                    <td class="p-3 text-emerald-400 font-semibold">Exclusão Definitiva das catracas e servidores</td>
                    <td class="p-3 text-slate-400">Art. 11 e 16 da LGPD (Dado pessoal sensível).</td>
                  </tr>
                  <tr>
                    <td class="p-3 font-medium text-white">Tokens de Notificação (Push / FCM)</td>
                    <td class="p-3 text-emerald-400 font-semibold">Exclusão Imediata</td>
                    <td class="p-3 text-slate-400">Art. 16 da LGPD.</td>
                  </tr>
                  <tr>
                    <td class="p-3 font-medium text-white">Histórico Contábil e Boletos Fiscais</td>
                    <td class="p-3 text-amber-400 font-semibold">Retenção Restrita por até 5 anos</td>
                    <td class="p-3 text-slate-400">Cumprimento de obrigação legal e fiscal (Código Civil / Tributário).</td>
                  </tr>
                  <tr>
                    <td class="p-3 font-medium text-white">Registros de Acesso à Portaria</td>
                    <td class="p-3 text-slate-300">Retenção Transitória para segurança coletiva</td>
                    <td class="p-3 text-slate-400">Legítimo interesse do condomínio e segurança patrimonial.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="space-y-3">
            <h2 class="text-base font-bold text-white uppercase tracking-wide border-l-2 border-emerald-400 pl-3">5. Prazos de Processamento</h2>
            <p>
              - O bloqueio de acesso ao aplicativo ocorre em <strong>até 48 horas úteis</strong>.<br />
              - A eliminação definitiva dos dados nos bancos operacionais e desprovisionamento biométrico é concluída em até <strong>15 (quinze) dias úteis</strong>, conforme previsto no Art. 19 da LGPD.<br />
              - O titular receberá confirmação por e-mail quando o processo for finalizado.
            </p>
          </section>

          <section class="space-y-3 border-t border-white/10 pt-6">
            <h2 class="text-base font-bold text-white uppercase tracking-wide border-l-2 border-emerald-400 pl-3">6. Contato com o DPO</h2>
            <p>
              Em caso de dúvidas, contate nosso Encarregado de Proteção de Dados pelo e-mail:
              <a href="mailto:suporte@clickprestarecondominios.com.br" class="text-emerald-400 underline font-semibold">suporte&#64;clickprestarecondominios.com.br</a>.
            </p>
          </section>
        </div>

        <!-- Rodapé -->
        <div class="text-center text-xs text-slate-500 border-t border-white/10 pt-6">
          &copy; 2026 Prestare Gestão / Click Condomínios. Todos os direitos reservados.
        </div>
      </div>
    </div>
  `
})
export class ExclusaoContaComponent {}
