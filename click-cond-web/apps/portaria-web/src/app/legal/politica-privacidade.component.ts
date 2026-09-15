import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-politica-privacidade',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="min-h-screen bg-slate-950 text-slate-300 py-12 px-4 sm:px-6 lg:px-8 selection:bg-emerald-500 selection:text-slate-950">
      <div class="max-w-4xl mx-auto space-y-8">
        
        <!-- Cabeçalho -->
        <div class="text-center space-y-3 border-b border-white/10 pb-8">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
            Documento Legal Oficial · Conformidade LGPD
          </div>
          <h1 class="text-3xl font-extrabold text-white tracking-tight sm:text-4xl">Política de Privacidade e Proteção de Dados</h1>
          <p class="text-sm text-slate-400">Última atualização: Setembro de 2026</p>
        </div>

        <!-- Conteúdo Legal -->
        <div class="space-y-6 text-sm leading-relaxed">
          <section class="space-y-3">
            <h2 class="text-base font-bold text-white uppercase tracking-wide border-l-2 border-emerald-400 pl-3">1. Introdução e Compromisso</h2>
            <p>
              O sistema <strong>Click Condomínios / Click Portaria</strong> (operado pela Prestare Soluções) valoriza a privacidade, a segurança física e a proteção dos dados pessoais de todos os condôminos, síndicos, funcionários, porteiros, visitantes e prestadores de serviços. Esta Política de Privacidade foi elaborada em estrita observância à <strong>Lei Geral de Proteção de Dados Pessoais (LGPD — Lei nº 13.709/2018)</strong>, estabelecendo as diretrizes de tratamento, bases legais, retenção e segurança das informações coletadas.
            </p>
          </section>

          <section class="space-y-3">
            <h2 class="text-base font-bold text-white uppercase tracking-wide border-l-2 border-emerald-400 pl-3">2. Dados Coletados</h2>
            <p>Coletamos unicamente as informações estritamente necessárias para a operação, governança e controle de segurança física condominial:</p>
            <ul class="list-disc list-inside space-y-1.5 text-slate-400 ml-2">
              <li><strong class="text-slate-300">Moradores e Condôminos:</strong> Nome completo, e-mail, telefone, CPF, bloco e unidade habitacional para autenticação, controle de acessos e comunicação oficial.</li>
              <li><strong class="text-slate-300">Visitantes e Prestadores de Serviços:</strong> Nome completo, documento de identificação (RG/CPF), telefone, registro fotográfico facial, cópia/foto do documento comprobatório e empresa/categoria de serviço.</li>
              <li><strong class="text-slate-300">Registros de Acesso e Tráfego:</strong> Data, horário, ponto de entrada/saída, método de liberação (biometria facial, QR code, PIN temporário ou tag RFID).</li>
            </ul>
          </section>

          <section class="space-y-3">
            <h2 class="text-base font-bold text-white uppercase tracking-wide border-l-2 border-emerald-400 pl-3">3. Tratamento de Dados Sensíveis e Biometria Facial (Art. 11 LGPD)</h2>
            <p>
              Em conformidade com o <strong>Art. 5º, II da LGPD</strong>, dados biométricos (como imagens faciais e modelos vetoriais de reconhecimento facial) são classificados como <strong>dados pessoais sensíveis</strong>. O tratamento desses dados pelo sistema Click Portaria fundamenta-se nas seguintes premissas e bases legais:
            </p>
            <div class="p-4 rounded-xl bg-slate-900 border border-emerald-500/20 space-y-2">
              <p class="font-semibold text-emerald-400 text-xs uppercase tracking-wider">Bases Legais Aplicáveis (Art. 11, II, "g" e Art. 7º, IX e X da LGPD):</p>
              <ul class="list-disc list-inside space-y-1 text-xs text-slate-300 ml-1">
                <li><strong>Prevenção a fraudes e segurança dos titulares:</strong> A autenticação biométrica destina-se a impedir a entrada de indivíduos não autorizados ou falsidade ideológica nas dependências do condomínio.</li>
                <li><strong>Incolumidade física e proteção patrimonial:</strong> Garantir a integridade física de residentes, funcionários e visitantes em áreas restritas.</li>
                <li><strong>Consentimento e Ciência:</strong> No ato da coleta presencial ou digital, o titular é informado sobre a finalidade da captura facial e documental.</li>
              </ul>
              <p class="text-xs text-slate-400 pt-1">
                <strong>Destinação Técnica:</strong> Os dados biométricos são processados e transmitidos por canal seguro exclusivamente aos controladores de acesso físicos locais autorizados do condomínio. <em>Não há compartilhamento comercial, venda ou uso de biometria para fins publicitários.</em>
              </p>
            </div>
          </section>

          <section class="space-y-3">
            <h2 class="text-base font-bold text-white uppercase tracking-wide border-l-2 border-emerald-400 pl-3">4. Princípios de Minimização e Medidas de Segurança Técnica (Art. 46)</h2>
            <p>Adotamos medidas técnicas e administrativas aptas a proteger os dados pessoais de acessos não autorizados e situações acidentais ou ilícitas:</p>
            <ul class="list-disc list-inside space-y-1.5 text-slate-400 ml-2">
              <li><strong class="text-slate-300">Mascaramento de Documentos:</strong> Em todas as listagens operacionais (portaria e consoles), os números de CPF e documentos são exibidos parcialmente mascarados (ex: <code class="text-emerald-400">123.***.***-45</code>), evitando exposição desnecessária.</li>
              <li><strong class="text-slate-300">Segurança de Credenciais (PIN):</strong> Códigos PIN de acesso físico são temporários, protegidos contra revelação em tela e expiram automaticamente após o uso ou fim do período agendado.</li>
              <li><strong class="text-slate-300">Trilha de Auditoria (Logs de Acesso):</strong> Operações críticas, como visualização detalhada de dados de identificação e exportação de relatórios, são registradas com data, hora, identificação do operador e endereço IP.</li>
            </ul>
          </section>

          <section class="space-y-3">
            <h2 class="text-base font-bold text-white uppercase tracking-wide border-l-2 border-emerald-400 pl-3">5. Política de Retenção e Descarte de Dados (Art. 15 e 16 LGPD)</h2>
            <p>
              Os dados pessoais são conservados apenas pelo tempo necessário para atingir as finalidades para as quais foram coletados, observados os prazos legais:
            </p>
            <ul class="list-disc list-inside space-y-1.5 text-slate-400 ml-2">
              <li><strong class="text-slate-300">Visitantes e Prestadores Concluídos:</strong> Fotografias faciais e cópias de documentos de visitantes cuja visita já foi concluída são mantidas por até <strong>180 (cento e oitenta) dias</strong> para fins de auditoria de segurança ou cobertura de seguros do condomínio. Após esse prazo, as mídias são automaticamente expurgadas do sistema.</li>
              <li><strong class="text-slate-300">Histórico de Acesso:</strong> O registro cronológico e estatístico da passagem física (data, hora e unidade visitada) é conservado em formato minimizado para fins de cumprimento de obrigação legal ou defesa em processos judiciais.</li>
              <li><strong class="text-slate-300">Moradores:</strong> Os dados de condôminos permanecem ativos enquanto perdurar a relação contratual ou residencial com o condomínio.</li>
            </ul>
          </section>

          <section class="space-y-3">
            <h2 class="text-base font-bold text-white uppercase tracking-wide border-l-2 border-emerald-400 pl-3">6. Direitos do Titular (Art. 18 LGPD)</h2>
            <p>
              O titular dos dados pessoais tem o direito de solicitar a confirmação do tratamento, acesso aos dados, correção de dados incompletos, anonimização, bloqueio ou eliminação de dados desnecessários.
            </p>
            <div class="p-4 rounded-xl bg-slate-900 border border-white/5 space-y-2 mt-2">
              <p class="font-semibold text-white text-xs">Canal de Atendimento ao Titular e Exclusão:</p>
              <p class="text-xs text-slate-400">
                Moradores podem solicitar a exclusão de sua conta pelo aplicativo móvel (<em>"Configurações > Excluir Minha Conta"</em>). Visitantes e prestadores podem solicitar esclarecimentos ou requerer a remoção de dados por meio da administração do condomínio ou diretamente pelo e-mail do Encarregado de Dados (DPO): <code class="text-emerald-400">suporte&#64;clickprestarecondominios.com.br</code>.
              </p>
            </div>
          </section>

          <section class="space-y-3">
            <h2 class="text-base font-bold text-white uppercase tracking-wide border-l-2 border-emerald-400 pl-3">7. Encarregado de Proteção de Dados (DPO)</h2>
            <p>
              Para esclarecer dúvidas sobre esta Política de Privacidade ou sobre as práticas de proteção de dados do condomínio e da operadora da plataforma, contate nosso Encarregado de Dados através do canal oficial citado acima.
            </p>
          </section>
        </div>

        <!-- Rodapé Legal -->
        <div class="pt-8 border-t border-white/10 text-center text-xs text-slate-500">
          Click Condomínios / Click Portaria &copy; 2026. Todos os direitos reservados. Plataforma em conformidade com a Lei nº 13.709/2018 (LGPD).
        </div>
      </div>
    </div>
  `,
})
export class PoliticaPrivacidadeComponent {}
