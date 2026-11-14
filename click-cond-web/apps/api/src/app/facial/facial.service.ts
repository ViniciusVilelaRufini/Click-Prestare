import { normalizarFotoParaTerminal } from './foto-terminal.util';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { CardAoVivoService } from '../card-ao-vivo/card-ao-vivo.service';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  FacialDeviceClientService,
  FacialDeviceConfig,
  MotivoDiagnostico,
} from './facial-device-client.service';
import {
  FABRICANTES_SUPORTADOS,
  normalizarFabricante as normalizarFabricanteDoRegistro,
  valoresGravadosCom,
} from './fabricantes';
import { EnrollSessionService } from './enroll-session.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { TenantAccessService } from '../auth/tenant-access.service';
import { ConsentimentosService, REVOGADO_PELO_OPERADOR } from '../consentimentos/consentimentos.service';
import { ConsentimentosTerceirosService } from '../consentimentos/consentimentos-terceiros.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AccessStateService } from './access-state.service';
import { AgentBridgeService } from './agent-bridge.service';
import {
  bloqueadoPorRegrasAcesso,
  CategoriaPessoa,
  confiancaInsuficiente,
  RegraAcessoLike,
} from './access-rules.util';
import {
  corrigirPlacaOcr,
  normalizarPlaca,
  placaValida,
  variantesPlaca,
} from './placa.util';
import { normalizarPayloadNativo } from './webhook-payload.util';
import { gruposCodigoTag } from '../common/tag-codigo.util';
import { VISITA_NAO_ENCERRADA } from '../common/tag-em-uso.util';
import { whereVagaVigente } from '../vagas/vaga-vigente.util';
import { decryptSecret, encryptSecret } from './device-secret.util';
import { calcularIdade, temTermoResponsavel } from '../common/idade.util';
import { normalizarMac } from './descoberta.service';
import { agentesSemRedeInterna, urlExternaSegura } from '../common/url-segura.util';
import { validarIpDispositivo, validarPortaDispositivo } from './device-endereco.util';
import { StorageService } from '../common/storage/storage.service';
import { executarComLock, OpcoesLock } from '../common/lock-distribuido';
import { hojeBrasilia, horaBrasilia, intervaloHojeBrasilia } from '../common/hora-brasilia.util';
import { EstadoCompartilhado } from '../common/estado-compartilhado';
import { fimEmMinutos } from '../areas-sociais/fim-reserva.util';
import { CredenciaisValidacaoService, TEXTO_NEGACAO } from '../credenciais/credenciais-validacao.service';
import { ehCodigoDinamico, rotuloDeCredencial } from '../credenciais/codigo-dinamico.util';

/**
 * Contenção de ruído do código dinâmico por leitor (em memória): negações
 * por formato/assinatura/credencial desconhecida gravam no máximo um evento
 * `negado` a cada JANELA_RUIDO_QR_MS por leitor. Não há bloqueio do leitor:
 * o MAC de 64 bits já torna a força bruta inútil, e bloquear deixaria
 * qualquer um (10 QR forjados) travar o leitor para todos. A leitura sempre
 * é validada; só a gravação do evento repetido é contida.
 */
const JANELA_RUIDO_QR_MS = 10 * 1000;
const MOTIVOS_RUIDO_QR: ReadonlySet<string> = new Set(['desconhecida', 'assinatura']);

/** Validade da marca de bulk sync em andamento (instância que morreu no meio não trava o condomínio para sempre). */
const BULK_SYNC_TTL_MS = 2 * 60 * 60 * 1000;
/** Resultado da varredura de fantasmas (roda de hora em hora) vale até a próxima, com folga. */
const FANTASMAS_TTL_MS = 3 * 60 * 60 * 1000;

/**
 * Ciclo de negócio do tickDiasSemanaSync (porta: hora 0 de Brasília, mesma do
 * tick): uma passada por dia no cluster, chave = data de Brasília. Com período
 * por tempo, um tick às 23:xx (porta fechada) marcaria o período e o das 0:xx
 * seria pulado.
 */
function cicloViradaDoDia(): string | null {
  if (horaBrasilia() !== 0) return null;
  return hojeBrasilia().toISOString().slice(0, 10);
}

function pessoasMigrationEnabled(prisma?: any): boolean {
  if (process.env['PESSOAS_MIGRATION_ENABLED'] !== 'true') return false;
  if (prisma && prisma.visitas === undefined && prisma.pessoas === undefined) return false;
  return true;
}

/**
 * Capacidades por fabricante — vêm do registro único (fabricantes.ts), em vez
 * de espalhar `fabricante === 'intelbras'` pelo módulo. Ao adicionar uma marca
 * nova, inclua-a LÁ e implemente o comando correspondente nos DOIS clientes
 * (facial-device-client.service.ts e agent/).
 */

/** Marcas que sabem listar/remover pessoas gravadas no aparelho (varredura de fantasmas). */
export const FABRICANTES_COM_LISTAGEM: readonly string[] = valoresGravadosCom('listagem');

/** Marcas cuja câmera devolve um quadro JPEG para usar como foto de cadastro. */
export const FABRICANTES_COM_CAMERA: readonly string[] = valoresGravadosCom('camera');

/**
 * A Intelbras é OEM da Dahua: mesmo firmware, mesmo protocolo (RPC2 + cgi).
 * Só a varredura de fantasmas reconhecia `dahua`; todo o resto comparava com
 * `'intelbras'`, então um device gravado como `dahua` caía no caminho HTTP
 * genérico `/persons` e o cadastro nunca chegava ao aparelho. Normalizar na
 * borda mantém UM caminho de código para as duas grafias.
 *
 * Delega ao registro (que também aceita caixa, espaços e aliases de grafia);
 * marca que o registro não conhece volta como veio.
 */
export function normalizarFabricante(fabricante: string): string {
  return normalizarFabricanteDoRegistro(fabricante) ?? fabricante;
}

/**
 * Forma em que o fabricante é GRAVADO no cadastro do dispositivo: a que os
 * drivers esperam, quando o registro reconhece a marca ("Intelbras",
 * " HIKVISION ", "Control iD" → chave canônica). Um valor que o banco já
 * guarda como distinto (`dahua`, opção própria na tela) NÃO é trocado pela
 * chave canônica — só perde caixa/espaços. Marca fora do registro é aceita
 * como veio, sem os espaços das pontas.
 */
function fabricanteParaGravar(bruto: string): string {
  const limpo = bruto.trim();
  const chave = normalizarFabricanteDoRegistro(limpo);
  if (chave === null) return limpo;
  const minusculo = limpo.toLowerCase();
  const gravados: readonly string[] = FABRICANTES_SUPORTADOS[chave].valoresGravados;
  return gravados.includes(minusculo) ? minusculo : chave;
}

/** Texto pronto para o operador, por motivo do diagnóstico do "Testar conexão". */
const MENSAGEM_DIAGNOSTICO_OK = 'Aparelho respondeu normalmente.';
const MENSAGENS_DIAGNOSTICO: Record<MotivoDiagnostico, string> = {
  agente_offline:
    'O Agente Local deste condomínio não está conectado. Verifique se o computador da portaria está ligado e com internet.',
  credencial_invalida:
    'O aparelho respondeu, mas recusou o usuário ou a senha. Confira as credenciais cadastradas.',
  sem_resposta:
    'O aparelho não respondeu nesse endereço. Confira o IP, o cabo de rede e se ele está ligado.',
  recusado:
    'Há um equipamento nesse IP, mas a porta informada está fechada. Confira a porta.',
  protocolo_inesperado:
    'O equipamento respondeu de um jeito inesperado para esta marca. Confira se o fabricante selecionado está correto.',
  marca_sem_http:
    'Esta marca não é controlada pela rede por aqui; o teste de conexão não se aplica.',
};

/**
 * Leitores que ficam de UM lado do portão e só informam a credencial lida
 * (tag, QR, placa) — nunca a direção. Diferente do terminal facial único
 * bidirecional, para eles:
 *   - `sentido: 'auto'` sem direção no payload é ENTRADA para morador e
 *     funcionário (não alterna pelo último acesso — alternar fazia a cancela
 *     abrir uma vez sim, outra não); visitante/prestador seguem o estado real
 *     da visita (dentro → saída, fora → entrada);
 *   - o anti-passback por histórico não se aplica (antena só na entrada com
 *     saída livre negaria a segunda entrada para sempre), salvo
 *     ANTI_PASSBACK_MODE=hard.
 */
export const TIPOS_LEITOR_SEM_DIRECAO = ['tag_reader', 'qrcode_reader', 'lpr'] as const;

export function ehLeitorSemDirecao(tipo: string | null | undefined): boolean {
  return (TIPOS_LEITOR_SEM_DIRECAO as readonly string[]).includes(tipo ?? '');
}

/**
 * Anti-passback em modo "hard"? Mesma variável e mesmo padrão lidos pelo
 * AccessStateService (`ANTI_PASSBACK_MODE`, ausente = 'soft').
 */
function antiPassbackHard(): boolean {
  return (process.env.ANTI_PASSBACK_MODE ?? 'soft') === 'hard';
}

/** Tipos de dispositivo que o módulo conhece (os mesmos da tela de terminais). */
export const TIPOS_DISPOSITIVO = [
  'facial',
  'botoeira',
  'catraca',
  'tag_reader',
  'qrcode_reader',
  'lpr',
] as const;

/** Intervalo mínimo entre avisos de "payload sem credencial" do mesmo dispositivo. */
const AVISO_SEM_CREDENCIAL_MS = 10 * 60 * 1000;

/** Valores de `Facial_Devices.sentido`. */
export const SENTIDOS_DISPOSITIVO = ['auto', 'entrada', 'saida'] as const;

/** Limites das colunas de Facial_Devices (prisma/schema.prisma). */
const DEVICE_NOME_MAX = 100;
const DEVICE_FABRICANTE_MAX = 50;

/** Intervalo mínimo entre avisos de "agente autenticou com token de dispositivo", por token. */
const AVISO_TOKEN_DISPOSITIVO_MS = 60 * 60 * 1000;

/** Quem é o agente que autenticou — ver `FacialService.resolveAgente`. */
export interface AgenteResolvido {
  idCondominio: number;
  /**
   * true quando o token apresentado NÃO é o agent_token do condomínio e sim o
   * webhook_token de um dispositivo (compatibilidade com agente antigo).
   */
  viaTokenDispositivo?: boolean;
  /** Dispositivo dono do token, quando `viaTokenDispositivo`. */
  idDispositivo?: number;
  /**
   * true quando `viaTokenDispositivo` e o condomínio não tem agent_token configurado (nulo/vazio):
   * instalação em que o agente foi configurado com a URL do webhook de um dispositivo.
   */
  condominioSemAgentToken?: boolean;
}

export interface CreateDeviceDto {
  id_condominio: number;
  nome: string;
  tipo?: string;
  /** auto | entrada | saida — como interpretar a direção dos acessos. */
  sentido?: string;
  /** Confiança mínima (%) do reconhecimento facial; 0 = desligado. */
  confianca_minima?: number;
  fabricante: string;
  modelo?: string;
  ip: string;
  porta?: number;
  api_user?: string;
  api_password?: string;
  /**
   * Área de lazer que este terminal monitora (opcional). Preenchido = os acessos
   * deste device contam para a ocupação daquela área. null/omitido = terminal comum.
   */
  id_area_social?: number | null;
  /**
   * Liga o CONTROLE DE ACESSO POR RESERVA na área vinculada (só entra quem
   * reservou). Aplicado à Areas_Sociais.controle_acesso_facial da área do
   * id_area_social. Separado da ocupação. NUNCA usar na entrada principal.
   */
  controle_acesso_facial?: number | boolean;
  /** MAC/série vindos da descoberta na rede (etapa 3) — identidade para corrigir IP. */
  mac?: string | null;
  numero_serie?: string | null;
}

export interface UpdateDeviceDto extends Partial<CreateDeviceDto> {
  /**
   * 0/false = tira o terminal de operação sem apagar o histórico (o agente para
   * de falar com ele). É a saída para terminal com acessos registrados, que
   * removeDevice recusa excluir.
   */
  ativo?: number | boolean;
}

export interface WebhookEventDto {
  device_id?: string;
  event?: string;
  person_id?: string;
  external_id?: string;
  timestamp?: string;
  confidence?: number;
  direction?: string;
  card_uid?: string;
  qrcode?: string;
  /**
   * Placa lida por câmera LPR. Câmeras que fazem push HTTP mandam aqui; as que
   * só expõem log de eventos são lidas pelo Agente Local, que preenche este
   * campo. Terminal com tipo 'lpr' também aceita a placa em external_id, que é
   * o campo genérico usado pelos demais leitores.
   */
  placa?: string;
  /**
   * Evento REENVIADO pelo store-and-forward do agente (aconteceu enquanto a
   * internet estava fora). Processa normalmente (auditoria + estado de
   * entrada/saída com o timestamp original), mas NÃO aciona abertura
   * automática nem aplica debounce — a pessoa já passou fisicamente.
   */
  backlog?: boolean;
}

// O enrollment liga AUTOMATICAMENTE quando há terminal facial cadastrado — a
// própria existência de devices (checada em cada sync) controla o fluxo, então
// não precisa de flag manual para "começar a funcionar". FACIAL_INTEGRATION_ENABLED
// vira um kill-switch explícito: só desliga tudo quando setado para "false".
const FACIAL_DISABLED = process.env.FACIAL_INTEGRATION_ENABLED === 'false';

// URL pública (GitHub Release) do executável do Agente Local. Fica como padrão
// para os botões/instalador funcionarem sem depender de env; pode ser
// sobrescrita por AGENT_DOWNLOAD_URL (ex.: ao publicar uma nova versão).
const AGENT_DOWNLOAD_URL =
  process.env.AGENT_DOWNLOAD_URL ||
  'https://github.com/Viniciusvile/Click-Prestare/releases/latest/download/click-agent.exe';

/**
 * Linhas "echo" que escrevem o laco de reinicio (run-agent-service.cmd) de
 * dentro de um bloco "( ... ) > arquivo" de .bat. SAO AS MESMAS LINHAS de
 * agent/install-windows.bat, e o que elas geram e exatamente
 * agent/run-agent-service.cmd (agent-installer-bat.spec.ts confere os tres).
 * Escape: `%` vira `%%`; fora de aspas, `( ) < > & |` levam `^`; linha em
 * branco e `echo:`. Comentarios em ASCII de proposito: acento/travessao
 * dentro de um "echo" num bloco "(...)" corrompe o parsing do cmd.exe.
 *
 * O que o .cmd faz: recupera uma troca de exe que parou no meio, rotaciona
 * agent-service.log (>5 MB) enquanto ninguem segura o arquivo, confia na
 * CA do Windows, roda o exe e - com uma auto-atualizacao pendente
 * (atualizacao.json) - conta as saidas com erro da versao nova; na 3a,
 * volta o click-agent.old.exe (a versao nova caia antes de o proprio
 * agente conseguir reverter). Espera com "ping" (timeout falha sem console).
 */
export const LINHAS_ECHO_LACO_SERVICO: readonly string[] = [
  'echo @echo off',
  'echo cd /d "%%~dp0"',
  'echo:',
  'echo :loop',
  'echo REM Recuperacao: se a atualizacao trocou o exe e o processo morreu no meio',
  'echo REM dos dois renames, so sobra o click-agent.old.exe no disco.',
  'echo if not exist "%%~dp0click-agent.exe" if exist "%%~dp0click-agent.old.exe" ^(',
  'echo   ren "%%~dp0click-agent.old.exe" "click-agent.exe"',
  'echo ^)',
  'echo:',
  'echo REM Sem atualizacao pendente, zera o contador de falhas da versao nova.',
  'echo if not exist "%%~dp0atualizacao.json" if exist "%%~dp0atualizacao-falhas.txt" del "%%~dp0atualizacao-falhas.txt"',
  'echo:',
  'echo REM Rotacao do log: tem que ser AQUI, nao dentro do agente. O ">>" abaixo',
  'echo REM abre o arquivo antes do processo existir e o handle fica em uso',
  'echo REM durante toda a execucao - o proprio agente tentando renomear seu',
  'echo REM stdout herdado falha com EBUSY. Aqui, entre uma execucao e a proxima,',
  'echo REM nenhum processo segura o arquivo.',
  'echo for %%%%A in ^("%%~dp0agent-service.log"^) do if %%%%~zA GTR 5242880 move /y "%%~dp0agent-service.log" "%%~dp0agent-service.1.log" ^>nul',
  'echo:',
  'echo REM Confia no repositorio de certificados do Windows - redes de condominio',
  'echo REM as vezes tem antivirus que inspeciona HTTPS.',
  'echo set "NODE_USE_SYSTEM_CA=1"',
  'echo "%%~dp0click-agent.exe" ^>^> "%%~dp0agent-service.log" 2^>^&1',
  'echo set "SAIDA=%%errorlevel%%"',
  'echo:',
  'echo REM Versao nova que cai ANTES de subir nao chega ao rollback do proprio',
  'echo REM agente. Com atualizacao.json presente, cada saida com erro conta em',
  'echo REM atualizacao-falhas.txt; na 3a, volta o click-agent.old.exe. O',
  'echo REM atualizacao.json fica: o exe antigo, ao subir, marca a versao nova',
  'echo REM como recusada e nao a baixa de novo.',
  'echo if "%%SAIDA%%"=="0" goto espera',
  'echo if not exist "%%~dp0atualizacao.json" goto espera',
  'echo set "FALHAS=0"',
  'echo if exist "%%~dp0atualizacao-falhas.txt" set /p FALHAS=^<"%%~dp0atualizacao-falhas.txt"',
  'echo set /a FALHAS+=1',
  'echo ^>"%%~dp0atualizacao-falhas.txt" echo %%FALHAS%%',
  'echo if %%FALHAS%% LSS 3 goto espera',
  'echo if not exist "%%~dp0click-agent.old.exe" goto espera',
  'echo ^>^>"%%~dp0agent-service.log" echo [servico] versao nova falhou %%FALHAS%%x ao iniciar - voltando para o click-agent.old.exe',
  'echo move /y "%%~dp0click-agent.exe" "%%~dp0click-agent.bad.exe" ^>nul',
  'echo move /y "%%~dp0click-agent.old.exe" "%%~dp0click-agent.exe" ^>nul',
  'echo del "%%~dp0atualizacao-falhas.txt"',
  'echo:',
  'echo :espera',
  'echo REM "timeout" falha na hora sem console de verdade ^(tarefa SYSTEM, sem',
  'echo REM sessao interativa^) e viraria busy-loop; "ping" nao depende de console.',
  'echo ping -n 6 127.0.0.1 ^>nul',
  'echo goto loop',
];

/** Ajusta a tarefa: o padrao do schtasks mata a tarefa com 72h e nao a
 *  roda (ou a para) na bateria - o laco do agente e infinito. */
export const COMANDO_AJUSTE_TAREFA =
  'powershell -NoProfile -Command "Set-ScheduledTask -TaskName ClickPortariaAgent -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1))"';

/**
 * Tranca a pasta do agente: a tarefa roda como SYSTEM, entao so SYSTEM
 * (S-1-5-18) e Administradores (S-1-5-32-544) podem escrever ou ler ali - sem
 * isto um usuario comum trocava o click-agent.exe/run-agent-service.cmd e
 * ganhava SYSTEM, ou lia o AGENT_TOKEN do .env. Dono vira Administradores e os
 * arquivos existentes voltam a herdar a ACL da pasta. Usa %DIR% (com a barra
 * final). As MESMAS linhas estao em agent/install-windows.bat (um teste confere).
 */
export const LINHAS_TRANCAR_PASTA_AGENTE: readonly string[] = [
  'icacls "%DIR%." /setowner *S-1-5-32-544 /T /C /Q >nul',
  'icacls "%DIR%." /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F /Q',
  'if errorlevel 1 (',
  '  echo [ERRO] Nao consegui proteger a pasta do agente. Rode este arquivo como Administrador.',
  '  pause',
  '  exit /b 1',
  ')',
  'icacls "%DIR%*" /reset /T /C /Q >nul 2>nul',
];

/**
 * instalar-agente-<condominio>.bat do portal: 1 clique instala OU ATUALIZA.
 * Para a tarefa e o processo ANTES de mexer em qualquer arquivo (o cmd.exe
 * le o .cmd em execucao pelo deslocamento - reescreve-lo com o laco rodando
 * embaralha os comandos; e o .exe em uso nao pode ser sobrescrito), baixa
 * SEMPRE o exe do portal para click-agent.new.exe e so entao o move por
 * cima do click-agent.exe (download que falha mantem o exe atual), grava a
 * configuracao, o laco de reinicio, registra a tarefa e a inicia.
 */
export function montarInstaladorBat(apiBase: string, token: string, downloadUrl: string): string {
  const baixaExe = downloadUrl
    ? [
        'echo Baixando o agente...',
        'if exist "%NOVO%" del "%NOVO%"',
        `powershell -NoProfile -Command "$ErrorActionPreference = 'Stop'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '${downloadUrl}' -OutFile '%NOVO%'"`,
        'if errorlevel 1 (',
        '  if exist "%NOVO%" del "%NOVO%"',
        '  echo [AVISO] Nao consegui baixar o agente - mantendo o que ja esta nesta pasta.',
        ')',
        'if exist "%NOVO%" move /y "%NOVO%" "%EXE%" >nul',
      ]
    : [];
  const linhas = [
    '@echo off',
    'setlocal',
    // Pasta fixa e protegida - nao a pasta de onde o .bat rodou (Downloads),
    // que qualquer usuario escreve: a tarefa roda como SYSTEM.
    'set "DIR=%ProgramFiles%\\ClickAgente\\"',
    'set "EXE=%DIR%click-agent.exe"',
    'set "NOVO=%DIR%click-agent.new.exe"',
    'set "ENVFILE=%DIR%.env"',
    'set "CMDFILE=%DIR%run-agent-service.cmd"',
    '',
    'REM 1) Para o agente antigo (tarefa + processo) antes de trocar qualquer arquivo',
    'schtasks /End /TN "ClickPortariaAgent" >nul 2>&1',
    'taskkill /F /IM click-agent.exe >nul 2>&1',
    'ping -n 3 127.0.0.1 >nul',
    'REM Instalacao manual substitui qualquer auto-atualizacao pendente',
    'if exist "%DIR%atualizacao.json" del "%DIR%atualizacao.json"',
    'if exist "%DIR%atualizacao-falhas.txt" del "%DIR%atualizacao-falhas.txt"',
    '',
    'REM 2) Pasta protegida do agente: so SYSTEM e Administradores (a tarefa roda como SYSTEM)',
    'if not exist "%DIR%" mkdir "%DIR%"',
    ...LINHAS_TRANCAR_PASTA_AGENTE,
    'if not exist "%EXE%" if exist "%~dp0click-agent.exe" copy /y "%~dp0click-agent.exe" "%EXE%" >nul',
    '',
    'REM 3) Baixa a versao atual do agente (instala ou atualiza)',
    ...baixaExe,
    'if not exist "%EXE%" (',
    '  echo [ERRO] click-agent.exe nao encontrado nesta pasta. Baixe-o pelo portal e rode de novo.',
    '  pause',
    '  exit /b 1',
    ')',
    '',
    'REM 4) Escreve a configuracao do condominio',
    '(',
    `echo API_URL=${apiBase}`,
    `echo AGENT_TOKEN=${token}`,
    ') > "%ENVFILE%"',
    '',
    'REM 5) Escreve o laco de reinicio (run-agent-service.cmd)',
    '(',
    ...LINHAS_ECHO_LACO_SERVICO,
    ') > "%CMDFILE%"',
    '',
    'REM 6) Inicia com o Windows, sem limite de 72h nem parada na bateria',
    'schtasks /Create /TN "ClickPortariaAgent" /TR "\\"%CMDFILE%\\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F',
    'if errorlevel 1 (',
    '  echo [ERRO] Falha ao registrar a tarefa. Rode este arquivo como Administrador.',
    '  pause',
    '  exit /b 1',
    ')',
    `${COMANDO_AJUSTE_TAREFA} >nul`,
    'if errorlevel 1 echo [AVISO] Nao consegui ajustar as opcoes da tarefa - ela pode parar sozinha apos 72h.',
    'schtasks /Run /TN "ClickPortariaAgent"',
    'echo.',
    'echo Pronto! Agente instalado em %DIR% e rodando. Confira "Agente conectado" no portal.',
    'pause',
  ];
  return linhas.join('\r\n') + '\r\n';
}

/**
 * Filtro da credencial de visitante/prestador (PIN ou tag). A tag vem como
 * lista de variantes do código lido — ver `gruposCodigoTag`.
 */
type CredencialVisitaWhere = {
  id_condominio: number;
  /**
   * Visita exata (credencial dinâmica de visita): com ele o PIN só confirma
   * que a visita segue valendo, e nenhuma outra visita de mesmo PIN entra.
   */
  id?: number;
  codigo_acesso?: string;
  tag_rfid?: string | { in: string[] };
  /** Só visita NÃO encerrada — ver `VISITA_NAO_ENCERRADA`. */
  OR?: Array<{ data_saida: null } | { liberado: number }>;
};


@Injectable()
export class FacialService {
  private readonly logger = new Logger(FacialService.name);
  /** Condomínios cuja última passada do `tickSyncRetry` foi a carga de terminal pendente. */
  private readonly tickCargaPendenteFeita = new Set<number>();
  /** Último aviso de "payload sem credencial" por dispositivo (amostragem do log). */
  private readonly avisoSemCredencialEm = new Map<number, number>();
  /** Último `negado` de ruído de código dinâmico gravado por leitor (ms). Ver JANELA_RUIDO_QR_MS. */
  private readonly ruidoQrGravadoEm = new Map<number, number>();
  /**
   * Estado compartilhado entre as instâncias da API: marca de bulk sync em
   * andamento por condomínio (`facial:bulk:<id>`, evita rodar em paralelo nas
   * duas instâncias) e o resultado da última varredura de fantasmas.
   */
  private _estado?: EstadoCompartilhado;
  private get estado(): EstadoCompartilhado {
    return (this._estado ??= new EstadoCompartilhado(this.prisma));
  }

  /**
   * Tick agendado que roda UMA vez no cluster: a instância que pegar o lock
   * (GET_LOCK no MySQL) roda; a outra pula este ciclo. `periodo` é o período
   * em ms (uma vez por período no cluster — os timers das instâncias não são
   * alinhados; ver OpcoesLock.intervaloMinimoMs) ou, para job com porta de
   * calendário, as opções com `cicloDeNegocio`.
   */
  private noCluster(nome: string, tick: () => Promise<unknown>, periodo: number | OpcoesLock): () => void {
    return () =>
      void executarComLock(
        this.prisma,
        nome,
        async () => {
          await tick();
        },
        typeof periodo === 'number' ? { intervaloMinimoMs: periodo } : periodo,
      );
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: FacialDeviceClientService,
    private readonly notifications: NotificationsService,
    private readonly enrollSessions: EnrollSessionService,
    private readonly auditoria: AuditoriaService,
    private readonly accessState: AccessStateService,
    private readonly agent: AgentBridgeService,
    private readonly tenant: TenantAccessService,
    private readonly consentimentos: ConsentimentosService,
    private readonly consentimentosTerceiros: ConsentimentosTerceirosService,
    // Bucket privado: a foto que vai ao terminal é baixada por link assinado.
    private readonly storage?: StorageService,
    // Card ao vivo da portaria remota (opcional: specs instanciam com a lista curta).
    @Optional() private readonly cardAoVivo?: CardAoVivoService,
    // QR dinâmico (opcional: specs antigos instanciam com a lista curta; sem
    // ele, código dinâmico é negado e a opção "QR no app" conta como desligada).
    @Optional() private readonly credenciais?: CredenciaisValidacaoService,
  ) {
    // Re-sincroniza quem tem restrição de dia da semana ao virar o dia (0h BRT).
    // Delay de 5 min no boot para aguardar banco conectar após deploy.
    setTimeout(this.noCluster('facial:tickDiasSemanaSync', () => this.tickDiasSemanaSync(), { cicloDeNegocio: cicloViradaDoDia }), 5 * 60 * 1000).unref?.();
    setInterval(this.noCluster('facial:tickDiasSemanaSync', () => this.tickDiasSemanaSync(), { cicloDeNegocio: cicloViradaDoDia }), 60 * 60 * 1000).unref?.();

    // Cron de expiração automática de visitantes e prestadores
    setTimeout(this.noCluster('facial:tickExpiracaoAutomatica', () => this.tickExpiracaoAutomatica(), 15 * 60 * 1000), 2 * 60 * 1000).unref?.();
    setInterval(this.noCluster('facial:tickExpiracaoAutomatica', () => this.tickExpiracaoAutomatica(), 15 * 60 * 1000), 15 * 60 * 1000).unref?.();

    // Tick novo — pré-enrolamento 30 min antes da chegada (a cada 15 min, delay 3 min)
    setTimeout(this.noCluster('facial:tickPreEnrolamento', () => this.tickPreEnrolamento(), 15 * 60 * 1000), 3 * 60 * 1000).unref?.();
    setInterval(this.noCluster('facial:tickPreEnrolamento', () => this.tickPreEnrolamento(), 15 * 60 * 1000), 15 * 60 * 1000).unref?.();

    // Tick novo — varredura de fantasmas (uma vez por dia às 3h BRT, delay 10 min)
    setTimeout(this.noCluster('facial:tickFantasmas', () => this.tickFantasmas(), 60 * 60 * 1000), 10 * 60 * 1000).unref?.();
    setInterval(this.noCluster('facial:tickFantasmas', () => this.tickFantasmas(), 60 * 60 * 1000), 60 * 60 * 1000).unref?.();

    // Tick novo — retry automático de sync: quem ficou 'pending'/'error'
    // (upload ou REMOÇÃO que não chegou ao aparelho) é re-tentado sem
    // depender de clique manual no portal. Só roda com agente online.
    setTimeout(this.noCluster('facial:tickSyncRetry', () => this.tickSyncRetry(), 30 * 60 * 1000), 7 * 60 * 1000).unref?.();
    setInterval(this.noCluster('facial:tickSyncRetry', () => this.tickSyncRetry(), 30 * 60 * 1000), 30 * 60 * 1000).unref?.();

    // Tick novo — áreas sociais: pré-enrola/reconcilia reservas aprovadas de
    // hoje no facial da área (delay 4 min, a cada 10 min).
    setTimeout(this.noCluster('facial:tickReservasAreas', () => this.tickReservasAreas(), 10 * 60 * 1000), 4 * 60 * 1000).unref?.();
    setInterval(this.noCluster('facial:tickReservasAreas', () => this.tickReservasAreas(), 10 * 60 * 1000), 10 * 60 * 1000).unref?.();
  }

  /**
   * Re-tenta sincronizações pendentes a cada 30 min, por condomínio que tem
   * agente ONLINE (sem agente o sync falharia de novo — não gasta ciclo).
   * Reusa o back-fill onlyPending, que já cobre upload de rostos novos,
   * remoções pendentes de revogados e a re-extensão diária de quem tem
   * restrição de dias da semana.
   */
  private async tickSyncRetry() {
    if (FACIAL_DISABLED || !this.prisma.isConnected) return;
    try {
      const devices = await this.prisma.facial_Devices.findMany({
        where: { ativo: 1, tipo: 'facial' },
        select: { id: true, id_condominio: true, ultima_sincr: true },
      });
      const porCondominio = new Map<number, number[]>();
      const cargaPendente = new Map<number, number[]>();
      for (const d of devices) {
        const ids = porCondominio.get(d.id_condominio) ?? [];
        ids.push(d.id);
        porCondominio.set(d.id_condominio, ids);
        // Terminal ONLINE que nunca recebeu a carga completa (ou cuja carga
        // falhou no meio): `ultima_sincr` nulo — ver agendarCargaDoTerminal.
        if (d.ultima_sincr === null && this.agent.isOnline(d.id)) {
          cargaPendente.set(d.id_condominio, [
            ...(cargaPendente.get(d.id_condominio) ?? []),
            d.id,
          ]);
        }
      }
      for (const [idCond, ids] of porCondominio) {
        if (!ids.some((id) => this.agent.isOnline(id))) continue;
        // Só cabe uma sincronização em massa por condomínio de cada vez: a
        // carga do terminal pendente e o back-fill se ALTERNAM a cada passada,
        // para um terminal que não responde não deixar o back-fill sem rodar.
        const pendentes = cargaPendente.get(idCond);
        if (pendentes?.length && !this.tickCargaPendenteFeita.has(idCond)) {
          this.tickCargaPendenteFeita.add(idCond);
          await this.syncAllForCondominio(idCond, { deviceIds: pendentes });
          continue;
        }
        this.tickCargaPendenteFeita.delete(idCond);
        await this.syncAllForCondominio(idCond, { onlyPending: true });
      }
    } catch (e: any) {
      this.logger.warn(`tickSyncRetry erro: ${e?.message ?? e}`);
    }
  }

  // ---------- Enrollment guiado (RFID/QR) ----------

  /**
   * Inicia sessão de captura. Operador apresenta o crachá no leitor; quando
   * uma tag não cadastrada chega no webhook desse device, o UID é desviado
   * para esta sessão em vez de processar como acesso. Portal faz polling.
   */
  async startEnrollCapture(idDevice: number) {
    const device = await this.getDevice(idDevice);
    if (device.tipo !== 'tag_reader' && device.tipo !== 'qrcode_reader') {
      throw new BadRequestException(
        'Captura guiada só funciona em leitores RFID ou QR',
      );
    }
    return await this.enrollSessions.start(idDevice);
  }

  async pollEnrollCapture(sessionId: string, user?: JwtPayload) {
    const session = await this.enrollSessions.get(sessionId);
    await this.assertSessionSameTenant(session.idDevice, user);
    return session;
  }

  async cancelEnrollCapture(sessionId: string, user?: JwtPayload) {
    const session = await this.enrollSessions.get(sessionId);
    await this.assertSessionSameTenant(session.idDevice, user);
    await this.enrollSessions.cancel(sessionId);
    return { ok: true };
  }

  private async assertSessionSameTenant(idDevice: number, user?: JwtPayload) {
    const device = await this.prisma.facial_Devices.findUnique({
      where: { id: idDevice },
      select: { id_condominio: true },
    });
    await this.tenant.assertEntidade(device?.id_condominio, user, `sessão de enrollment`);
  }

  /**
   * Este módulo usava `assertSameTenant` (tenant.util), que se AUTO-DESLIGA
   * quando o JWT não tem `id_condominio` — e nenhum token do app tem. Para
   * morador, síndico e funcionário do app a checagem era um no-op: dava para
   * ler o histórico de entradas e saídas de qualquer pessoa, de qualquer
   * condomínio, só trocando o id na URL.
   *
   * O `TenantAccessService` resolve o vínculo de verdade no banco — é
   * exatamente o caso que ele foi escrito para cobrir.
   */
  async assertMoradorSameTenant(idMorador: number, user?: JwtPayload) {
    const m = await this.prisma.moradores.findUnique({
      where: { id: idMorador },
      select: { id_condominio: true, id_user: true },
    });
    if (!m) throw new NotFoundException(`Morador ${idMorador} não encontrado`);
    await this.tenant.assertEntidade(m.id_condominio, user, `morador #${idMorador}`);

    // Histórico de acesso é o registro de ir e vir de uma pessoa. Estar no
    // mesmo prédio não dá direito a ele: morador vê só o próprio.
    if (this.ehMoradorMobile(user)) {
      const idUser = Number(user?.user?.id ?? user?.sub);
      if (!idUser || Number(m.id_user) !== idUser) {
        throw new ForbiddenException('Acesso negado: este histórico não é seu.');
      }
    }
  }

  /** Idem para visitante: morador só alcança visita de apartamento dele. */
  async assertVisitanteSameTenant(idVisitante: number, user?: JwtPayload) {
    let idCondominio: number | undefined;
    let idApartamento: number | undefined;

    if (pessoasMigrationEnabled(this.prisma)) {
      const vis = await this.prisma.visitas.findUnique({
        where: { id: idVisitante },
        select: { id_condominio: true, id_apartamento: true },
      });
      if (vis) {
        idCondominio = vis.id_condominio;
        idApartamento = vis.id_apartamento;
      } else {
        const p = await this.prisma.pessoas.findUnique({
          where: { id: idVisitante },
          include: {
            visitas: {
              select: { id_condominio: true, id_apartamento: true },
              orderBy: { created_at: 'desc' },
              take: 1,
            },
          },
        });
        if (p) {
          idCondominio = p.id_condominio;
          idApartamento = p.visitas[0]?.id_apartamento;
        }
      }
    }

    if (idCondominio === undefined) {
      const v = await this.prisma.visitantes.findUnique({
        where: { id: idVisitante },
        select: { id_condominio: true, id_apartamento: true },
      });
      if (!v)
        throw new NotFoundException(`Visitante ${idVisitante} não encontrado`);
      idCondominio = v.id_condominio;
      idApartamento = v.id_apartamento;
    }

    await this.tenant.assertEntidade(idCondominio, user, `visitante #${idVisitante}`);

    if (this.ehMoradorMobile(user)) {
      const idUser = Number(user?.user?.id ?? user?.sub);
      let vinculo = null;
      if (idUser && idApartamento) {
        vinculo = await this.prisma.apartamentos_Users.findFirst({
          where: { id_user: idUser, id_apto: idApartamento },
          select: { id_apto: true },
        });
      }
      if (!vinculo && idUser && pessoasMigrationEnabled(this.prisma)) {
        const aptoIds = await this.prisma.visitas.findMany({
          where: {
            OR: [
              { id: idVisitante },
              { id_pessoa: idVisitante },
            ],
          },
          select: { id_apartamento: true },
        });
        const ids = aptoIds.map((a: any) => a.id_apartamento).filter(Boolean);
        if (ids.length > 0) {
          vinculo = await this.prisma.apartamentos_Users.findFirst({
            where: { id_user: idUser, id_apto: { in: ids } },
            select: { id_apto: true },
          });
        }
      }
      if (!vinculo) {
        throw new ForbiddenException('Acesso negado: esta visita não é do seu apartamento.');
      }
    }
  }

  /**
   * Morador do app. Funcionário é equipe (a maioria não tem apartamento) e
   * síndico administra — mesma definição usada nos demais módulos.
   */
  private ehMoradorMobile(user?: JwtPayload): boolean {
    if (!user) return false;
    const tipo = (user.typeAccess ?? user.user?.typeAccess ?? '').toString().toLowerCase();
    return !user.id_condominio && tipo !== 'sindico' && tipo !== 'funcionario';
  }

  // ---------- Devices CRUD ----------

  async listDevices(idCondominio: number) {
    if (!this.prisma.isConnected) return [];
    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: idCondominio },
      orderBy: { created_at: 'desc' },
    });
    // agent_online: indica se há um Agente Local fazendo polling deste device
    // agora. É o sinal de "está pronto para receber comandos da nuvem".
    const flagPorArea = await this.flagsControleAcessoPorArea(devices);
    return devices.map((d) => ({
      ...d,
      api_password: decryptSecret(d.api_password),
      agent_online: this.agent.isOnline(d.id),
      // null = desconhecido (sem reporte recente do agente); true/false = status
      // real do aparelho na LAN, atualizado pelo heartbeat do agente.
      device_online: this.agent.isDeviceOnline(d.id),
      // Controle de acesso por reserva da ÁREA vinculada (p/ o toggle na UI).
      controle_acesso_facial:
        d.id_area_social != null ? flagPorArea.get(d.id_area_social) ?? 0 : 0,
    }));
  }

  /**
   * Resumo de saúde do facial pro condomínio: terminais offline, status do
   * agente local (com last-seen) e o resultado da última varredura de
   * biometria órfã (tickFantasmas). Agrega dados que já existiam espalhados
   * (listDevices, AgentBridgeService, AuditLog) — não introduz fonte nova.
   */
  async getHealthSummary(idCondominio: number) {
    const devices = await this.listDevices(idCondominio);

    const ativos = devices.filter((d) => d.ativo === 1);
    const offline = ativos.filter((d) => d.device_online === false);
    const semReporte = ativos.filter((d) => d.device_online === null);
    const agentOnline = ativos.some((d) => d.agent_online);
    const lastSeenTimestamps = ativos
      .map((d) => this.agent.lastSeenAt(d.id))
      .filter((t): t is number => t != null);
    const agentLastSeenAt = lastSeenTimestamps.length
      ? new Date(Math.max(...lastSeenTimestamps))
      : null;

    const { inicio: inicioDoDia } = intervaloHojeBrasilia();
    const eventosFantasmas = this.prisma.isConnected
      ? await this.prisma.auditLog.findMany({
        where: {
          id_condominio: idCondominio,
          modulo: 'facial-health',
          acao: 'FANTASMAS_REMOVIDOS',
          created_at: { gte: inicioDoDia },
        },
        orderBy: { created_at: 'desc' },
        select: { created_at: true, descricao: true, detalhes: true },
      })
      : [];
    const removidosHoje = eventosFantasmas.reduce((acc, ev) => {
      try {
        const d = ev.detalhes ? JSON.parse(ev.detalhes as string) : null;
        return acc + (Number(d?.count) || 0);
      } catch {
        return acc;
      }
    }, 0);

    const varredura = (
      await this.estado.obter<{
        terminouEm: string;
        terminaisVarridos: number;
        terminaisComFalha: { id: number; nome: string; erro: string }[];
      }>(`facial:fantasmas:${idCondominio}`)
    )?.valor;

    return {
      terminais: {
        total: ativos.length,
        offline: offline.map((d) => ({ id: d.id, nome: d.nome })),
        semReporteRecente: semReporte.map((d) => ({ id: d.id, nome: d.nome })),
      },
      agente: {
        online: agentOnline,
        lastSeenAt: agentLastSeenAt,
      },
      fantasmas: {
        // Resultado da última varredura DESTE condomínio (null até a primeira
        // rodar após o boot). Terminal que não respondeu vem em terminaisComFalha.
        ultimaVarreduraEm: varredura?.terminouEm ? new Date(varredura.terminouEm) : null,
        terminaisVarridos: varredura?.terminaisVarridos ?? 0,
        terminaisComFalha: varredura?.terminaisComFalha ?? [],
        removidosHoje,
        eventosHoje: eventosFantasmas.map((ev) => ({
          em: ev.created_at,
          descricao: ev.descricao,
        })),
      },
    };
  }

  /** Mapa id_area → controle_acesso_facial p/ um conjunto de devices. */
  private async flagsControleAcessoPorArea(
    devices: { id_area_social: number | null }[],
  ): Promise<Map<number, number>> {
    const areaIds = [
      ...new Set(
        devices.map((d) => d.id_area_social).filter((x): x is number => x != null),
      ),
    ];
    if (areaIds.length === 0) return new Map();
    const areas = await this.prisma.areas_Sociais.findMany({
      where: { id: { in: areaIds } },
      select: { id: true, controle_acesso_facial: true },
    });
    return new Map(areas.map((a) => [a.id, a.controle_acesso_facial]));
  }

  /**
   * Recebe o status dos aparelhos reportado pelo Agente Local (heartbeat
   * periódico). Confina aos dispositivos do condomínio do token.
   */
  /**
   * Processa transição de status de dispositivo com verificação em banco para evitar
   * duplicações de eventos e ocorrências (especialmente após restarts ou períodos longos offline).
   */
  private async handleDeviceStatusTransition(
    device: { id: number; nome: string; tipo?: string | null; id_condominio: number },
    online: boolean,
    isManual = false,
  ) {
    const { shouldOpenTicket } = await this.agent.reportDeviceStatus(
      device.id,
      online,
    );

    const ticketDesc = `O dispositivo "${device.nome}" (${device.tipo || 'facial'}) está offline há mais de 10 minutos.`;

    if (!online) {
      // 1. Log de Auditoria: registra APENAS se o último status registrado no banco não for OFFLINE
      const lastAudit = await this.prisma.auditLog.findFirst({
        where: {
          id_condominio: device.id_condominio,
          modulo: 'dispositivos',
          entidade_id: device.id,
        },
        orderBy: { created_at: 'desc' },
      });

      if (!lastAudit || lastAudit.acao !== 'OFFLINE') {
        await this.auditoria.registrar({
          id_condominio: device.id_condominio,
          usuario_nome: device.nome,
          acao: 'OFFLINE',
          modulo: 'dispositivos',
          entidade_id: device.id,
          descricao: `O dispositivo "${device.nome}" (${device.tipo || 'facial'}) ficou offline${isManual ? ' (teste manual)' : ''}.`,
        });
      }

      // 2. Chamado de Ocorrência: abre apenas UM chamado se estiver > 10 min offline e não houver chamado aberto
      const existingTicket = await this.prisma.ocorrencias.findFirst({
        where: {
          id_condominio: device.id_condominio,
          descricao: ticketDesc,
          status: { in: ['Pendente', 'Ciente'] },
        },
      });

      const isOfflineLongEnough = shouldOpenTicket || (
        lastAudit &&
        lastAudit.acao === 'OFFLINE' &&
        Date.now() - new Date(lastAudit.created_at).getTime() >= 10 * 60 * 1000
      );

      if (isOfflineLongEnough && !existingTicket) {
        let categoria = await this.prisma.ocorrencias_Categorias.findFirst({
          where: { nome: 'Dispositivos' },
        });
        if (!categoria) {
          categoria = await this.prisma.ocorrencias_Categorias.create({
            data: { nome: 'Dispositivos', prioridade: 1 },
          });
        }

        await this.prisma.ocorrencias.create({
          data: {
            descricao: ticketDesc,
            tipo: categoria.id,
            status: 'Pendente',
            id_condominio: device.id_condominio,
            origem: 'sistema',
          },
        });
      }
    } else {
      // Online = true:
      // 1. Log de Auditoria: registra transição apenas se o último registro no banco era OFFLINE
      const lastAudit = await this.prisma.auditLog.findFirst({
        where: {
          id_condominio: device.id_condominio,
          modulo: 'dispositivos',
          entidade_id: device.id,
        },
        orderBy: { created_at: 'desc' },
      });

      if (lastAudit && lastAudit.acao === 'OFFLINE') {
        await this.auditoria.registrar({
          id_condominio: device.id_condominio,
          usuario_nome: device.nome,
          acao: 'ONLINE',
          modulo: 'dispositivos',
          entidade_id: device.id,
          descricao: `O dispositivo "${device.nome}" (${device.tipo || 'facial'}) voltou a ficar online${isManual ? ' (teste manual)' : ''}.`,
        });
      }

      // 2. Resolve automaticamente chamados pendentes para esse dispositivo
      const openTickets = await this.prisma.ocorrencias.findMany({
        where: {
          id_condominio: device.id_condominio,
          descricao: ticketDesc,
          status: { in: ['Pendente', 'Ciente'] },
        },
      });

      for (const oco of openTickets) {
        await this.prisma.ocorrencias.update({
          where: { id: oco.id },
          data: {
            status: 'Solucionado',
            resposta: 'O dispositivo voltou a ficar online.',
            resposta_at: new Date(),
          },
        });
      }
    }
  }

  /**
   * Recebe o status dos aparelhos reportado pelo Agente Local (heartbeat
   * periódico). Confina aos dispositivos do condomínio do token.
   */
  async reportDeviceStatuses(
    idCondominio: number,
    statuses: { deviceId: number; online: boolean }[],
  ) {
    if (!Array.isArray(statuses) || statuses.length === 0) return { ok: true };

    const devices = await this.prisma.facial_Devices.findMany({
      where: {
        id_condominio: idCondominio,
        id: { in: statuses.map((s) => Number(s?.deviceId)).filter(Boolean) },
      },
      select: { id: true, nome: true, tipo: true },
    });
    const deviceMap = new Map(devices.map((d) => [d.id, d]));

    for (const s of statuses) {
      const id = Number(s?.deviceId);
      const dev = deviceMap.get(id);
      if (dev) {
        await this.handleDeviceStatusTransition(
          { id: dev.id, nome: dev.nome, tipo: dev.tipo, id_condominio: idCondominio },
          !!s.online,
          false,
        );
      }
    }
    return { ok: true };
  }

  async getDevice(id: number) {
    const d = await this.prisma.facial_Devices.findUnique({ where: { id } });
    if (!d) throw new NotFoundException(`Terminal facial ${id} não encontrado`);
    const flagPorArea = await this.flagsControleAcessoPorArea([d]);
    return {
      ...d,
      api_password: decryptSecret(d.api_password),
      controle_acesso_facial:
        d.id_area_social != null ? flagPorArea.get(d.id_area_social) ?? 0 : 0,
    };
  }

  /**
   * Dispositivos ativos de um condomínio — usado pelo agente em "modo
   * condomínio" (um único token gerencia todos os aparelhos do condomínio).
   */
  async getActiveDevices(idCondominio: number) {
    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: idCondominio, ativo: 1 },
    });
    return devices.map((d) => ({
      ...d,
      api_password: decryptSecret(d.api_password),
    }));
  }

  async findDeviceByToken(token: string) {
    const d = await this.prisma.facial_Devices.findFirst({
      // Condomínio desligado no CRM não recebe comandos nem credenciais (pentest P-11).
      where: { webhook_token: token, ativo: 1, condominio: { ativo: 1 } },
    });
    if (!d) throw new UnauthorizedException('Token de webhook inválido');
    return { ...d, api_password: decryptSecret(d.api_password) };
  }

  /**
   * Resolve o condomínio a partir do token do agente. Aceita só o agent_token
   * (escopo do condomínio); o webhook_token de um dispositivo é recusado aqui
   * (ver `resolveAgente`, que o aceita recortado ao próprio dispositivo).
   *
   * Condomínio desativado (`ativo = 0`) é recusado nos dois caminhos: a
   * desativação comercial precisa parar o controle de acesso físico junto,
   * senão o prédio continua abrindo a porta para todo mundo enquanto o
   * cliente já foi desligado do sistema.
   */
  async resolveCondominioForAgent(token: string): Promise<number> {
    // Escopo do condomínio inteiro é só do agent_token. O webhook_token de um dispositivo vale só para
    // ele (as rotas condo/* usam resolveAgente e recortam pelo idDispositivo).
    const agente = await this.resolveAgente(token);
    if (agente.viaTokenDispositivo) throw new UnauthorizedException('Token do agente inválido');
    return agente.idCondominio;
  }

  /**
   * Resolve o token do agente (agent_token ou webhook_token), dizendo também SE a
   * autenticação veio pelo token de um dispositivo (e de qual). Esse caminho
   * é compatibilidade com agente antigo: o token de UM aparelho é aceito nas
   * rotas `condo/:token/*`, mas recortado ao próprio aparelho (`idDispositivo`). Fica
   * registrado em log (uma vez por token a cada hora) para sabermos se ainda
   * há alguém dependendo dele antes de restringir.
   */
  async resolveAgente(token: string): Promise<AgenteResolvido> {
    const cond = await this.prisma.condominios.findFirst({
      where: { agent_token: token, ativo: 1 },
      select: { id: true },
    });
    if (cond) return { idCondominio: cond.id };
    const device = await this.prisma.facial_Devices.findFirst({
      where: { webhook_token: token, ativo: 1, condominio: { ativo: 1 } },
      // agent_token do condomínio na mesma consulta: sem ele, este é o único token do agente.
      select: { id: true, id_condominio: true, condominio: { select: { agent_token: true } } },
    });
    if (device) {
      this.avisarTokenDeDispositivo(token, device.id, device.id_condominio);
      const semAgentToken = !!device.condominio && !String(device.condominio.agent_token ?? '').trim();
      return {
        idCondominio: device.id_condominio,
        viaTokenDispositivo: true,
        idDispositivo: device.id,
        ...(semAgentToken && { condominioSemAgentToken: true }),
      };
    }
    throw new UnauthorizedException('Token do agente inválido');
  }

  /** Último aviso por token (hash, nunca o token em si). Em memória, por instância. */
  private readonly avisosTokenDispositivo = new Map<string, number>();

  private avisarTokenDeDispositivo(token: string, idDispositivo: number, idCondominio: number) {
    const chave = crypto.createHash('sha256').update(token).digest('hex');
    const agora = Date.now();
    const ultimo = this.avisosTokenDispositivo.get(chave);
    if (ultimo !== undefined && agora - ultimo < AVISO_TOKEN_DISPOSITIVO_MS) return;
    if (this.avisosTokenDispositivo.size > 5000) this.avisosTokenDispositivo.clear();
    this.avisosTokenDispositivo.set(chave, agora);
    this.logger.warn(
      `Agente autenticou com token de dispositivo (dispositivo ${idDispositivo}, condomínio ${idCondominio}) em vez do agent_token do condomínio — caminho de compatibilidade.`,
    );
  }

  /** Garante (e devolve) o agent_token estável do condomínio, gerando se faltar. */
  async getOrCreateAgentToken(idCondominio: number): Promise<string> {
    const cond = await this.prisma.condominios.findUnique({
      where: { id: idCondominio },
      select: { agent_token: true },
    });
    if (!cond)
      throw new NotFoundException(`Condomínio ${idCondominio} não encontrado`);
    if (cond.agent_token) return cond.agent_token;
    const token = crypto.randomBytes(32).toString('hex');
    await this.prisma.condominios.update({
      where: { id: idCondominio },
      data: { agent_token: token },
    });
    return token;
  }

  /** Token (para o portal exibir) + URL de download do executável. */
  async getAgentInfo(idCondominio: number) {
    const token = await this.getOrCreateAgentToken(idCondominio);
    return {
      agent_token: token,
      download_url: AGENT_DOWNLOAD_URL,
    };
  }

  /**
   * Gera o arquivo de configuração do agente já personalizado para o
   * condomínio: ".env" (config pura) ou "instalar.bat" (1 clique: baixa o exe,
   * grava a config e registra o serviço no Windows).
   */
  async getAgentConfigFile(
    idCondominio: number,
    apiUrl: string,
    format: 'env' | 'bat',
  ): Promise<{ filename: string; content: string; contentType: string }> {
    const cond = await this.prisma.condominios.findUnique({
      where: { id: idCondominio },
      select: { nome: true },
    });
    const token = await this.getOrCreateAgentToken(idCondominio);
    const apiBase = apiUrl.replace(/\/+$/, '');
    const slug =
      (cond?.nome ?? 'condominio')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 40) || 'condominio';

    if (format === 'bat') {
      return {
        filename: `instalar-agente-${slug}.bat`,
        content: montarInstaladorBat(apiBase, token, AGENT_DOWNLOAD_URL),
        contentType: 'application/octet-stream',
      };
    }

    return {
      filename: '.env',
      content: `# Agente Local — ${cond?.nome ?? ''}\r\nAPI_URL=${apiBase}\r\nAGENT_TOKEN=${token}\r\n`,
      contentType: 'text/plain; charset=utf-8',
    };
  }

  /** A área vinculada tem de ser do mesmo condomínio do dispositivo (senão grava/aciona dados de outro prédio). */
  private async assertAreaDoCondominio(idArea: number | null | undefined, idCondominio: number) {
    if (idArea == null) return;
    const area = await this.prisma.areas_Sociais.findFirst({
      where: { id: Number(idArea), id_condominio: Number(idCondominio) },
      select: { id: true },
    });
    if (!area) throw new BadRequestException('Área social não pertence a este condomínio.');
  }

  /**
   * Validação mínima dos campos do dispositivo (os DTOs são interfaces, sem
   * class-validator): devolve só os campos PRESENTES no dto, já limpos. Sem
   * isto o erro chegava ao operador como 500 cru do Prisma.
   *
   * `tipoAtual` (edição): a tela reenvia o form inteiro, então o tipo que o
   * dispositivo já tem nunca é recusado — só a troca para um tipo desconhecido.
   */
  private validarCamposDispositivo(
    dto: Partial<CreateDeviceDto>,
    opts: { criando: boolean; tipoAtual?: string },
  ): { nome?: string; tipo?: string; sentido?: string; fabricante?: string; confianca_minima?: number } {
    const out: { nome?: string; tipo?: string; sentido?: string; fabricante?: string; confianca_minima?: number } = {};

    if (opts.criando || dto.nome !== undefined) {
      const nome = typeof dto.nome === 'string' ? dto.nome.trim() : '';
      if (!nome) throw new BadRequestException('Campo "nome" é obrigatório.');
      if (nome.length > DEVICE_NOME_MAX) {
        throw new BadRequestException(`Campo "nome" deve ter no máximo ${DEVICE_NOME_MAX} caracteres.`);
      }
      out.nome = nome;
    }

    if (dto.tipo !== undefined && dto.tipo !== null) {
      const conhecido = (TIPOS_DISPOSITIVO as readonly string[]).includes(dto.tipo);
      if (!conhecido && dto.tipo !== opts.tipoAtual) {
        throw new BadRequestException(
          `Campo "tipo" inválido. Use um destes: ${TIPOS_DISPOSITIVO.join(', ')}.`,
        );
      }
      out.tipo = dto.tipo;
    }

    if (dto.sentido !== undefined && dto.sentido !== null) {
      if (!(SENTIDOS_DISPOSITIVO as readonly string[]).includes(dto.sentido)) {
        throw new BadRequestException(
          `Campo "sentido" inválido. Use um destes: ${SENTIDOS_DISPOSITIVO.join(', ')}.`,
        );
      }
      out.sentido = dto.sentido;
    }

    if (opts.criando || dto.fabricante !== undefined) {
      const fabricante = typeof dto.fabricante === 'string' ? dto.fabricante.trim() : '';
      if (!fabricante) throw new BadRequestException('Campo "fabricante" é obrigatório.');
      if (fabricante.length > DEVICE_FABRICANTE_MAX) {
        throw new BadRequestException(
          `Campo "fabricante" deve ter no máximo ${DEVICE_FABRICANTE_MAX} caracteres.`,
        );
      }
      out.fabricante = fabricanteParaGravar(fabricante);
    }

    if (dto.confianca_minima !== undefined && dto.confianca_minima !== null) {
      const bruto: unknown = dto.confianca_minima;
      const n =
        typeof bruto === 'number'
          ? bruto
          : typeof bruto === 'string' && bruto.trim() !== ''
            ? Number(bruto)
            : NaN;
      if (!Number.isInteger(n) || n < 0 || n > 100) {
        throw new BadRequestException(
          'Campo "confianca_minima" deve ser um número inteiro de 0 a 100.',
        );
      }
      out.confianca_minima = n;
    }

    return out;
  }

  /**
   * Dois cadastros ATIVOS do MESMO TIPO apontando para o mesmo aparelho (mesmo
   * ip:porta, ou mesmo MAC) no condomínio: os comandos e os eventos se
   * misturam. Recusa.
   *
   * Tipo diferente no mesmo endereço/MAC é permitido de propósito: é como se
   * cadastra o relé do próprio terminal facial como botoeira/catraca, para um
   * leitor de tag acioná-lo.
   *
   * Vale SÓ para terminal facial. Em leitor e abertura o endereço não
   * identifica o aparelho: duas antenas (entrada e saída) da mesma
   * controladora só fazem push, com o mesmo ip:porta/MAC e tokens diferentes;
   * dois relés da mesma placa idem. O "IP" de simulador ('sim'/'simulador')
   * também não é endereço — vários simuladores usam o mesmo valor.
   */
  private async assertDispositivoNaoDuplicado(alvo: {
    idCondominio: number;
    tipo: string;
    ip?: string;
    porta?: number;
    mac?: string | null;
    ignorarId?: number;
  }) {
    if (alvo.tipo !== 'facial') return;
    const outro = alvo.ignorarId !== undefined ? { id: { not: alvo.ignorarId } } : {};
    const ipDeSimulador = alvo.ip === 'sim' || alvo.ip === 'simulador';
    if (alvo.ip !== undefined && alvo.porta !== undefined && !ipDeSimulador) {
      const mesmoEndereco = await this.prisma.facial_Devices.findFirst({
        where: {
          id_condominio: alvo.idCondominio,
          ativo: 1,
          tipo: alvo.tipo,
          ip: alvo.ip,
          porta: alvo.porta,
          ...outro,
        },
        select: { nome: true },
      });
      if (mesmoEndereco) {
        throw new BadRequestException(
          `Já existe o dispositivo "${mesmoEndereco.nome}" do tipo ${alvo.tipo} nesse endereço (${alvo.ip}:${alvo.porta}).`,
        );
      }
    }
    if (alvo.mac) {
      const mesmoMac = await this.prisma.facial_Devices.findFirst({
        where: {
          id_condominio: alvo.idCondominio,
          ativo: 1,
          tipo: alvo.tipo,
          mac: alvo.mac,
          ...outro,
        },
        select: { nome: true },
      });
      if (mesmoMac) {
        throw new BadRequestException(
          `Já existe o dispositivo "${mesmoMac.nome}" do tipo ${alvo.tipo} com esse MAC (${alvo.mac}).`,
        );
      }
    }
  }

  /**
   * Carga completa de rostos SÓ do terminal informado, em segundo plano.
   *
   * "Pendente" é por pessoa, não por aparelho: sem isto o 2º facial do
   * condomínio (ou um reativado/reendereçado) ficava vazio até alguém clicar
   * em "Sincronizar rostos", porque todo mundo já estava 'synced' pelo 1º.
   * Nunca bloqueia nem derruba o cadastro: erro só vai para o log.
   *
   * O terminal fica marcado com CARGA PENDENTE (`ultima_sincr = null`, que é
   * "nunca recebeu carga" e vale para todas as instâncias). Só inicia agora se
   * o agente já está em contato com ele — no cadastro de um terminal novo
   * nunca está (o heartbeat por device só chega no próximo poll): a carga
   * falhava para todos e rebaixava para 'pending' quem seguia válido nos
   * outros terminais. Offline, quem dispara é a reconexão (AgentController) ou
   * o `tickSyncRetry`. Quem tira a marca é a carga concluída
   * (`syncAllForCondominio` restrito).
   */
  private agendarCargaDoTerminal(
    device: {
      id: number;
      id_condominio: number;
      tipo: string;
      ativo: number;
      ultima_sincr?: Date | null;
    },
    motivo: string,
  ) {
    if (device.tipo !== 'facial' || device.ativo !== 1) return;
    const online = !!this.agent?.isOnline?.(device.id);
    void Promise.resolve()
      .then(async () => {
        // Terminal recém-criado já nasce com ultima_sincr nulo.
        if (device.ultima_sincr != null) {
          await this.prisma.facial_Devices.update({
            where: { id: device.id },
            data: { ultima_sincr: null },
          });
        }
        if (!online) {
          this.logger.log(
            `Carga de rostos do terminal ${device.id} (${motivo}) fica PENDENTE: o agente ainda não está em contato com ele — inicia sozinha na reconexão.`,
          );
          return { adiada: true };
        }
        return this.syncAllForCondominio(device.id_condominio, { deviceIds: [device.id] });
      })
      .then((r: any) => {
        if (r?.started) {
          this.logger.log(
            `Carga de rostos do terminal ${device.id} iniciada (${motivo}): ${r.total} pessoa(s)`,
          );
        } else if (r?.alreadyRunning) {
          this.logger.warn(
            `Carga de rostos do terminal ${device.id} (${motivo}) NÃO iniciada: já há uma sincronização em massa rodando no condomínio ${device.id_condominio}. Use "Sincronizar rostos" depois que ela terminar.`,
          );
        } else if (r?.skipped) {
          this.logger.warn(
            `Carga de rostos do terminal ${device.id} (${motivo}) não iniciada: ${r.reason}`,
          );
        }
      })
      .catch((e: any) =>
        this.logger.warn(
          `Carga de rostos do terminal ${device.id} (${motivo}) falhou: ${e?.message ?? e}`,
        ),
      );
  }

  async createDevice(dto: CreateDeviceDto, operador?: JwtPayload) {
    const campos = this.validarCamposDispositivo(dto, { criando: true });
    const ip = validarIpDispositivo(dto.ip);
    const porta = validarPortaDispositivo(dto.porta ?? 80);
    await this.assertAreaDoCondominio(dto.id_area_social, dto.id_condominio);
    const mac = normalizarMac(dto.mac ?? null);
    await this.assertDispositivoNaoDuplicado({
      idCondominio: dto.id_condominio,
      tipo: campos.tipo ?? 'facial',
      ip,
      porta,
      mac,
    });
    const token = crypto.randomBytes(32).toString('hex');
    const created = await this.prisma.facial_Devices.create({
      data: {
        id_condominio: dto.id_condominio,
        nome: campos.nome as string,
        tipo: campos.tipo ?? 'facial',
        sentido: campos.sentido ?? 'auto',
        confianca_minima: campos.confianca_minima ?? 0,
        fabricante: campos.fabricante as string,
        modelo: dto.modelo ?? null,
        ip,
        porta,
        api_user: dto.api_user ?? null,
        api_password: encryptSecret(dto.api_password ?? null),
        id_area_social: dto.id_area_social ?? null,
        webhook_token: token,
        mac,
        numero_serie:
          typeof dto.numero_serie === 'string' && dto.numero_serie.trim()
            ? dto.numero_serie.trim().slice(0, 64)
            : null,
      },
    });
    await this.auditoria.registrar({
      id_condominio: dto.id_condominio,
      usuario_nome: operador?.nome ?? 'sistema',
      acao: 'DEVICE_CHANGE',
      modulo: 'facial',
      entidade_id: created.id,
      descricao: `Cadastrou dispositivo "${created.nome}" (${created.tipo})`,
      detalhes: {
        tipo: created.tipo,
        fabricante: created.fabricante,
        ip: created.ip,
      },
    });

    // Controle de acesso por reserva, como no updateDevice — mas na criação só
    // LIGA. A tela manda `false` por padrão; aplicar o "desligado" aqui tiraria
    // o controle de uma área que já o tinha por outro terminal (e re-enrolaria
    // todos os moradores nela). Desligar continua sendo pela edição.
    if (dto.controle_acesso_facial && created.id_area_social != null) {
      const idArea = created.id_area_social;
      await this.prisma.areas_Sociais.update({
        where: { id: idArea },
        data: { controle_acesso_facial: 1 },
      });
      this.reconcileAreaGating(idArea).catch((e) =>
        this.logger.warn(`reconcileAreaGating ${idArea}: ${e?.message ?? e}`),
      );
    }

    this.agendarCargaDoTerminal(created, 'terminal cadastrado');

    return { ...created, api_password: decryptSecret(created.api_password) };
  }

  /**
   * Gera um webhook_token NOVO para o dispositivo, invalidando o anterior
   * imediatamente (URL de webhook vazada em screenshot/log deixa de valer).
   * Auditado. Quem usa o token antigo (aparelho com push configurado ou o
   * Agente Local em modo por-device) precisa ser reconfigurado — o portal
   * avisa antes de confirmar.
   */
  async rotateWebhookToken(id: number, operador?: JwtPayload) {
    const device = await this.getDevice(id);
    const token = crypto.randomBytes(32).toString('hex');
    await this.prisma.facial_Devices.update({
      where: { id },
      data: { webhook_token: token },
    });
    await this.auditoria.registrar({
      id_condominio: device.id_condominio,
      usuario_nome: operador?.nome ?? 'sistema',
      acao: 'DEVICE_CHANGE',
      modulo: 'facial',
      entidade_id: id,
      descricao: `Rotacionou o token de webhook do dispositivo "${device.nome}" (token anterior invalidado)`,
      detalhes: { tipo: device.tipo, fabricante: device.fabricante },
    });
    return { ok: true, webhook_token: token };
  }

  async updateDevice(id: number, dto: UpdateDeviceDto, operador?: JwtPayload) {
    const antes = await this.getDevice(id);
    const campos = this.validarCamposDispositivo(dto, { criando: false, tipoAtual: antes.tipo });
    const ip = dto.ip !== undefined ? validarIpDispositivo(dto.ip) : undefined;
    const porta = dto.porta !== undefined ? validarPortaDispositivo(dto.porta ?? 80) : undefined;
    await this.assertAreaDoCondominio(dto.id_area_social, antes.id_condominio);

    // Duplicado: só confere quando o endereço ou o TIPO muda, ou o dispositivo
    // é reativado. A tela reenvia o form inteiro a cada edição — conferir
    // sempre travaria a edição de cadastros antigos que já estavam duplicados.
    // (A regra é por tipo: trocar o tipo pode criar um duplicado sem mexer no
    // endereço.)
    const ipFinal = ip ?? antes.ip;
    const portaFinal = porta ?? antes.porta;
    const tipoFinal = campos.tipo ?? antes.tipo;
    const ativoFinal = dto.ativo !== undefined ? (dto.ativo ? 1 : 0) : antes.ativo;
    const reativou = antes.ativo !== 1 && ativoFinal === 1;
    const mudouEndereco = ipFinal !== antes.ip || portaFinal !== antes.porta;
    const mudouTipo = tipoFinal !== antes.tipo;
    if (ativoFinal === 1 && (mudouEndereco || mudouTipo || reativou)) {
      await this.assertDispositivoNaoDuplicado({
        idCondominio: antes.id_condominio,
        tipo: tipoFinal,
        ip: ipFinal,
        porta: portaFinal,
        mac: reativou || mudouTipo ? antes.mac : null,
        ignorarId: id,
      });
    }

    const atual = await this.prisma.facial_Devices.update({
      where: { id },
      data: {
        ...(campos.nome !== undefined && { nome: campos.nome }),
        ...(campos.tipo !== undefined && { tipo: campos.tipo }),
        ...(campos.sentido !== undefined && { sentido: campos.sentido }),
        ...(campos.confianca_minima !== undefined && {
          confianca_minima: campos.confianca_minima,
        }),
        ...(campos.fabricante !== undefined && { fabricante: campos.fabricante }),
        ...(dto.modelo !== undefined && { modelo: dto.modelo }),
        ...(ip !== undefined && { ip }),
        ...(porta !== undefined && { porta }),
        ...(dto.api_user !== undefined && { api_user: dto.api_user }),
        ...(dto.api_password !== undefined && {
          api_password: encryptSecret(dto.api_password),
        }),
        ...(dto.id_area_social !== undefined && {
          id_area_social: dto.id_area_social,
        }),
        ...(dto.ativo !== undefined && { ativo: dto.ativo ? 1 : 0 }),
      },
    });
    // Detalha o que mudou (campos sensíveis: ip/porta/tipo/api_user — mudança
    // pode redirecionar a abertura para hardware diferente).
    const diff: Record<string, { de: any; para: any }> = {};
    for (const k of [
      'nome',
      'tipo',
      'sentido',
      'confianca_minima',
      'fabricante',
      'ip',
      'porta',
      'api_user',
      'ativo',
    ] as const) {
      if (dto[k] !== undefined && (antes as any)[k] !== (atual as any)[k]) {
        diff[k] = { de: (antes as any)[k], para: (atual as any)[k] };
      }
    }
    if (dto.api_password !== undefined)
      diff['api_password'] = { de: '***', para: '***' };
    await this.auditoria.registrar({
      id_condominio: atual.id_condominio,
      usuario_nome: operador?.nome ?? 'sistema',
      acao: 'DEVICE_CHANGE',
      modulo: 'facial',
      entidade_id: id,
      descricao: `Alterou dispositivo "${atual.nome}"`,
      detalhes: { changes: diff },
    });

    // Controle de acesso por reserva: aplica na ÁREA vinculada e reconcilia
    // (remove/re-enrola moradores conforme ligar/desligar).
    if (dto.controle_acesso_facial !== undefined && atual.id_area_social != null) {
      const valor = dto.controle_acesso_facial ? 1 : 0;
      await this.prisma.areas_Sociais.update({
        where: { id: atual.id_area_social },
        data: { controle_acesso_facial: valor },
      });
      this.reconcileAreaGating(atual.id_area_social).catch((e) =>
        this.logger.warn(`reconcileAreaGating ${atual.id_area_social}: ${e?.message ?? e}`),
      );
    }

    // Terminal facial reativado, que passou a ser OUTRO aparelho (endereço ou
    // fabricante trocado), ou que VIROU facial agora (tipo trocado): precisa
    // receber todo mundo de novo.
    if (
      reativou ||
      (mudouTipo && atual.tipo === 'facial') ||
      atual.ip !== antes.ip ||
      atual.porta !== antes.porta ||
      // Só a troca REAL de marca conta: regravar "Intelbras" como "intelbras"
      // (forma padronizada) não é outro aparelho.
      normalizarFabricante(atual.fabricante) !==
        normalizarFabricante(antes.fabricante)
    ) {
      this.agendarCargaDoTerminal(
        atual,
        reativou ? 'terminal reativado' : 'endereço/fabricante/tipo alterado',
      );
    }

    return { ...atual, api_password: decryptSecret(atual.api_password) };
  }

  /**
   * Reconcilia o gating de uma área ao ligar/desligar `controle_acesso_facial`.
   * LIGADO: remove do(s) terminal(is) da área todos os moradores SEM reserva
   * vigente e enrola os reservados (janela). DESLIGADO: re-enrola todos os
   * moradores do condomínio nesses terminais (restaura acesso). Fire-and-forget.
   */
  async reconcileAreaGating(idArea: number) {
    if (FACIAL_DISABLED || !this.prisma.isConnected) return;
    const area = await this.prisma.areas_Sociais.findUnique({ where: { id: Number(idArea) } });
    if (!area) return;
    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_area_social: Number(idArea), ativo: 1, tipo: 'facial' },
    });
    if (devices.length === 0) return;

    if (area.controle_acesso_facial !== 1) {
      // Desligou → re-enrola todos os moradores do condomínio nesses terminais.
      const moradores = await this.prisma.moradores.findMany({
        where: { id_condominio: area.id_condominio },
        select: { id: true },
      });
      const deviceIds = devices.map((d) => d.id);
      for (const m of moradores) {
        this.syncMorador(m.id, { deviceIds }).catch((e) =>
          this.logger.warn(`reconcile re-enroll morador ${m.id}: ${e?.message ?? e}`),
        );
      }
      return;
    }

    // Ligou → conjunto reservado (aptos com reserva aprovada vigente/futura).
    const hojeStr = new Date().toISOString().slice(0, 10);
    const reservas = await this.prisma.areas_Sociais_Agendamentos.findMany({
      where: { id_area_social: Number(idArea), status: 'aprovado', data: { gte: new Date(hojeStr) } },
      select: { id: true, id_apartamento: true },
    });
    const aptosReservados = [...new Set(reservas.map((r) => r.id_apartamento))];
    const usersReservados = aptosReservados.length
      ? await this.prisma.apartamentos_Users.findMany({
          where: { id_apto: { in: aptosReservados } },
          select: { id_user: true },
        })
      : [];
    const userIds = usersReservados.map((u) => u.id_user);
    const moradoresReservados = userIds.length
      ? await this.prisma.moradores.findMany({
          where: { id_user: { in: userIds }, id_condominio: area.id_condominio },
          select: { id: true },
        })
      : [];
    const reservadoSet = new Set(moradoresReservados.map((m) => m.id));

    // Remove do terminal quem NÃO tem reserva vigente — EXCETO funcionários
    // (administração acessa qualquer terminal, mesmo com a regra de reserva).
    const todos = await this.prisma.moradores.findMany({
      where: { id_condominio: area.id_condominio },
      select: { id: true, face_id: true, tipo: true },
    });
    for (const device of devices) {
      for (const m of todos) {
        const ehFuncionario = (m.tipo ?? '').toLowerCase() === 'funcionario';
        if (ehFuncionario || reservadoSet.has(m.id)) continue;
        try {
          await this.client.removePerson(this.toConfig(device), m.face_id ?? `morador_${m.id}`);
        } catch (e: any) {
          this.logger.warn(`reconcile remove morador ${m.id} device ${device.id}: ${e?.message ?? e}`);
        }
      }
    }
    // Enrola os reservados vigentes (com a janela do horário).
    for (const r of reservas) {
      this.syncReservaArea(r.id).catch((e) =>
        this.logger.warn(`reconcile enroll reserva ${r.id}: ${e?.message ?? e}`),
      );
    }

    // Garante que os FUNCIONÁRIOS (administração) fiquem enrolados no terminal:
    // moradores tipo='funcionario' + prestadores de serviço (com foto).
    const deviceIds = devices.map((d) => d.id);
    for (const m of todos) {
      if ((m.tipo ?? '').toLowerCase() === 'funcionario') {
        this.syncMorador(m.id, { deviceIds }).catch((e) =>
          this.logger.warn(`reconcile enroll funcionario-morador ${m.id}: ${e?.message ?? e}`),
        );
      }
    }
    const prestadores = await this.prisma.prestadores_servico.findMany({
      where: { id_condominio: area.id_condominio, foto_pessoa: { not: null } },
      select: { id: true },
    });
    for (const p of prestadores) {
      this.syncPrestadorServico(p.id, { deviceIds }).catch((e) =>
        this.logger.warn(`reconcile enroll prestador ${p.id}: ${e?.message ?? e}`),
      );
    }
  }

  async removeDevice(id: number, operador?: JwtPayload) {
    const device = await this.getDevice(id);

    // fk_acfac_device (RESTRICT) protege o histórico de acessos: um terminal
    // que já registrou algum evento não pode ser apagado, senão o Prisma
    // estoura P2003 com uma mensagem de constraint crua para o operador.
    const totalAcessos = await this.prisma.acessos_Facial.count({
      where: { id_device: id },
    });
    if (totalAcessos > 0) {
      await this.auditoria.registrar({
        id_condominio: device.id_condominio,
        usuario_nome: operador?.nome ?? 'sistema',
        acao: 'DEVICE_CHANGE',
        modulo: 'facial',
        entidade_id: id,
        descricao: `Tentativa de remover dispositivo "${device.nome}" recusada: ${totalAcessos} acesso(s) registrado(s)`,
        detalhes: { tipo: device.tipo, ip: device.ip, totalAcessos },
      });
      throw new ConflictException(
        `Este terminal tem ${totalAcessos} acesso(s) registrado(s) e não pode ser excluído, pois o histórico de acessos deve ser preservado. ` +
          'Para tirá-lo de operação, desative-o (ativo = 0) em vez de excluí-lo — isso remove o terminal do uso sem apagar o log.',
      );
    }

    await this.prisma.facial_Devices.delete({ where: { id } });
    await this.auditoria.registrar({
      id_condominio: device.id_condominio,
      usuario_nome: operador?.nome ?? 'sistema',
      acao: 'DEVICE_CHANGE',
      modulo: 'facial',
      entidade_id: id,
      descricao: `Removeu dispositivo "${device.nome}"`,
      detalhes: { tipo: device.tipo, ip: device.ip },
    });
    return { ok: true };
  }

  /**
   * "Testar conexão": além do sim/não (`online`, que a tela já usa), diz POR
   * QUÊ falhou (`motivo`/`detalhe`) e traz a `mensagem` pronta para o operador.
   *
   * Agente Local fora do ar (ou marca que nem fala HTTP) não diz nada sobre o
   * APARELHO: nesses casos não grava a transição de status — marcar o aparelho
   * como offline abriria ocorrência indevida.
   */
  async testDevice(id: number): Promise<{
    online: boolean;
    motivo: MotivoDiagnostico | null;
    detalhe?: string;
    mensagem: string;
  }> {
    const device = await this.getDevice(id);
    const diagnostico = await this.client.diagnosticar(this.toConfig(device));
    const online = diagnostico.ok === true;
    const motivo = online ? null : (diagnostico.motivo ?? 'sem_resposta');
    if (motivo !== 'agente_offline' && motivo !== 'marca_sem_http') {
      await this.handleDeviceStatusTransition(device, online, true);
    }
    return {
      online,
      motivo,
      ...(diagnostico.detalhe ? { detalhe: diagnostico.detalhe } : {}),
      mensagem: motivo === null ? MENSAGEM_DIAGNOSTICO_OK : MENSAGENS_DIAGNOSTICO[motivo],
    };
  }

  /**
   * Captura uma foto da CÂMERA do terminal facial (para usar no cadastro).
   * Devolve um data URL JPEG pronto para virar foto_pessoa.
   */
  async captureSnapshot(id: number) {
    const device = await this.getDevice(id);
    const imageBase64 = await this.client.captureSnapshot(this.toConfig(device));
    return { foto: `data:image/jpeg;base64,${imageBase64}` };
  }

  /**
   * Captura da câmera de UM terminal facial do condomínio (escolhe um online),
   * para o cadastro de morador/visitante sem precisar escolher o aparelho.
   */
  async captureSnapshotForCondominio(idCondominio: number) {
    const devices = await this.prisma.facial_Devices.findMany({
      where: {
        id_condominio: idCondominio,
        ativo: 1,
        tipo: 'facial',
        fabricante: { in: [...FABRICANTES_COM_CAMERA] },
      },
    });
    const device = devices.find((d) => this.agent.isOnline(d.id)) ?? devices[0];
    if (!device) {
      throw new BadRequestException(
        'Nenhum terminal facial com câmera disponível para captura.',
      );
    }
    const imageBase64 = await this.client.captureSnapshot(this.toConfig(device));
    return { foto: `data:image/jpeg;base64,${imageBase64}` };
  }

  async triggerDevice(id: number, operador?: JwtPayload) {
    const device = await this.getDevice(id);
    if (device.tipo !== 'botoeira' && device.tipo !== 'catraca') {
      throw new BadRequestException(
        'Apenas dispositivos do tipo Botoeira ou Catraca podem ser acionados remotamente.',
      );
    }
    const result = await this.client.triggerRelay(this.toConfig(device));

    const nomeOperador = operador?.nome ?? 'Operador (Portal Web)';

    // Sempre registra o evento — sucesso vira 'acionado_manual', falha vira
    // 'falha_acionamento' (auditável). O operador NÃO pode pensar que abriu
    // quando não abriu.
    await this.registrarEvento(device, {
      face_id: 'trigger_manual',
      tipo_pessoa: 'operador',
      id_pessoa: operador?.sub ?? null,
      nome_pessoa: result.ok ? nomeOperador : `${nomeOperador} (FALHA)`,
      evento: result.ok ? 'acionado_manual' : 'falha_acionamento',
    });

    // Auditoria estruturada — quem, quando, qual porta, sucesso/falha.
    // Essencial para responder "quem abriu a porta às 3h da manhã?".
    await this.auditoria.registrar({
      id_condominio: device.id_condominio,
      usuario_nome: nomeOperador,
      acao: 'MANUAL_OVERRIDE',
      modulo: 'facial',
      entidade_id: device.id,
      descricao: result.ok
        ? `Acionou manualmente ${device.tipo} "${device.nome}"`
        : `FALHA ao acionar ${device.tipo} "${device.nome}"`,
      detalhes: {
        device_nome: device.nome,
        device_tipo: device.tipo,
        device_ip: device.ip,
        success: result.ok,
        statusCode: result.statusCode,
        error: result.error,
      },
    });

    if (!result.ok) {
      // 502 Bad Gateway: nosso backend OK, mas o hardware downstream falhou
      throw new BadRequestException(
        result.error
          ? `Falha ao acionar dispositivo: ${result.error}`
          : `Falha ao acionar dispositivo (HTTP ${result.statusCode ?? 'sem resposta'}).`,
      );
    }

    return { ok: true };
  }

  /**
   * Abre um dispositivo por decisão da nuvem (QR dinâmico já validado, passe
   * do entregador). Assinatura combinada com o projeto 2: não alterar.
   *
   * Diferente de `triggerDevice` (rota manual do porteiro, que só aceita
   * botoeira/catraca), aciona qualquer tipo — inclusive o terminal facial, que
   * abre a própria porta por `open_door` na fila do agente. Não confere
   * regras, caminhos nem sentido: quem chama já decidiu. Não é exposto em
   * controller.
   *
   * `ctx.credencial` é um rótulo (ex.: `cred:<id>`), nunca o código lido.
   * Nunca lança: falha vira `{ ok: false, erro }` e evento
   * `falha_acionamento`.
   */
  async abrirDispositivoInterno(
    idDevice: number,
    ctx: {
      origem: 'credencial_qr' | 'delivery_portao';
      tipoPessoa: string;
      idPessoa?: number | null;
      nomePessoa: string;
      credencial?: string | null;
    },
  ): Promise<{ ok: boolean; erro?: string }> {
    let device: any;
    try {
      device = await this.prisma.facial_Devices.findFirst({ where: { id: idDevice, ativo: 1 } });
    } catch (err: any) {
      this.logger.warn(`Abertura interna: falha ao carregar o dispositivo ${idDevice}: ${err?.message ?? err}`);
      return { ok: false, erro: 'dispositivo_indisponivel' };
    }
    if (!device) return { ok: false, erro: 'dispositivo_indisponivel' };

    let ok = false;
    let erro: string | undefined;
    try {
      const result = await this.client.triggerRelay(this.toConfig(device));
      ok = result.ok === true;
      if (!ok) erro = result.error ?? `HTTP ${result.statusCode ?? 'sem resposta'}`;
    } catch (err: any) {
      erro = err?.message ?? String(err);
    }

    try {
      await this.registrarEvento(device, {
        face_id: ctx.credencial || ctx.origem,
        tipo_pessoa: ctx.tipoPessoa,
        id_pessoa: ctx.idPessoa ?? null,
        nome_pessoa: ok ? ctx.nomePessoa : `${ctx.nomePessoa} (FALHA ao acionar ${device.nome})`,
        evento: ok ? 'acionado_auto' : 'falha_acionamento',
      });
    } catch (err: any) {
      this.logger.warn(
        `Abertura interna: evento do dispositivo ${device.id} não gravado: ${err?.message ?? err}`,
      );
    }

    if (!ok) {
      this.logger.warn(`Abertura interna (${ctx.origem}) falhou no dispositivo ${device.id} (${device.nome}): ${erro}`);
      return { ok: false, erro };
    }
    return { ok: true };
  }

  /**
   * Lista pessoas com foto cadastrada no condomínio do terminal.
   * Usado pelo simulador (browser) para fazer matching local de rostos.
   * Fotos armazenadas como URL no R2 são baixadas e convertidas para
   * data URL (base64) para evitar problemas de CORS no canvas do face-api.
   */
  async listPersonsForDevice(idDevice: number) {
    const device = await this.getDevice(idDevice);
    const idCondominio = device.id_condominio;

    const [moradores, visitantes] = await Promise.all([
      this.prisma.moradores.findMany({
        where: { id_condominio: idCondominio, foto_pessoa: { not: null } },
        select: { id: true, nome: true, foto_pessoa: true },
      }),
      this.prisma.visitantes.findMany({
        where: {
          id_condominio: idCondominio,
          foto_pessoa: { not: null },
          data_saida: null,
        },
        select: { id: true, nome: true, foto_pessoa: true },
      }),
    ]);

    const rawPersons = [
      ...moradores.map((m) => ({
        external_id: `morador_${m.id}`,
        tipo: 'morador',
        nome: m.nome,
        foto: m.foto_pessoa,
      })),
      ...visitantes.map((v) => ({
        external_id: `visitante_${v.id}`,
        tipo: 'visitante',
        nome: v.nome,
        foto: v.foto_pessoa,
      })),
    ];

    const persons = await Promise.all(
      rawPersons.map(async (p) => ({
        ...p,
        foto: await this.toDataUrl(p.foto),
      })),
    );

    return {
      device: {
        id: device.id,
        nome: device.nome,
        webhook_token: device.webhook_token,
      },
      persons,
      total: persons.length,
    };
  }

  /**
   * Converte foto (URL HTTP do R2, base64 puro ou data: URL) em data URL
   * com prefix correto. Necessário para o face-api processar a imagem em
   * canvas sem CORS taint.
   */
  private async toDataUrl(foto: string | null): Promise<string | null> {
    if (!foto) return null;
    if (foto.startsWith('data:')) return foto;
    if (foto.startsWith('http://') || foto.startsWith('https://')) {
      try {
        if (!(await urlExternaSegura(foto))) {
          this.logger.warn('toDataUrl: URL de foto bloqueada (host interno/inválido).');
          return null;
        }
        const axios = (await import('axios')).default;
        const res = await axios.get((await this.storage?.assinarUrl(foto)) ?? foto, {
          ...agentesSemRedeInterna(), // o IP checado é o IP conectado (DNS rebinding)
          responseType: 'arraybuffer',
          timeout: 15000,
          maxRedirects: 0,
          maxContentLength: 15 * 1024 * 1024,
        });
        const mimeBruto = String(res.headers['content-type'] || 'image/jpeg').split(';')[0].trim().toLowerCase();
        const mime = /^image\/(jpeg|jpg|png|webp|gif|heic|heif)$/.test(mimeBruto) ? mimeBruto : 'image/jpeg';
        const b64 = Buffer.from(res.data).toString('base64');
        return `data:${mime};base64,${b64}`;
      } catch (err: any) {
        this.logger.warn(
          `Falha ao baixar foto ${foto}: ${err?.message ?? err}`,
        );
        return null;
      }
    }
    // Já é base64 puro
    return `data:image/jpeg;base64,${foto}`;
  }

  /**
   * Único ponto de gravação de evento de acesso.
   *
   * Deriva id_condominio, tipo e nome DO APARELHO que está sendo registrado,
   * em vez de aceitar do chamador. Antes disto, o fluxo de caminho de acesso
   * gravava id_device da ABERTURA junto de id_condominio do LEITOR — dois
   * objetos distintos, coerentes só porque pertenciam ao mesmo condomínio.
   *
   * nome_dispositivo é snapshot, mesmo papel de nome_pessoa: mantém o log
   * legível depois que o aparelho for removido.
   */
  private async registrarEvento(
    dispositivo: { id: number; id_condominio: number; tipo: string; nome: string },
    dados: {
      face_id: string;
      tipo_pessoa: string;
      id_pessoa?: number | null;
      nome_pessoa: string;
      evento: string;
      confianca?: number | null;
      timestamp?: Date;
    },
  ) {
    return this.prisma.acessos_Facial.create({
      data: {
        id_condominio: dispositivo.id_condominio,
        id_device: dispositivo.id,
        tipo_dispositivo: dispositivo.tipo,
        nome_dispositivo: dispositivo.nome,
        face_id: dados.face_id,
        tipo_pessoa: dados.tipo_pessoa,
        id_pessoa: dados.id_pessoa ?? null,
        nome_pessoa: dados.nome_pessoa,
        evento: dados.evento,
        confianca: dados.confianca ?? null,
        timestamp: dados.timestamp ?? new Date(),
      },
    });
  }

  // ---------- Sync ----------

  /**
   * Categorias fisicamente autorizadas num terminal pelas regras ATIVAS
   * (whitelist). null = terminal sem regras = todas as categorias liberadas.
   *
   * Só considera CATEGORIA porque é o que dá para impor via CADASTRO: quem não
   * é de uma categoria permitida não fica cadastrado no aparelho, então o
   * aparelho NEGA fisicamente (sem depender da nuvem no instante da abertura).
   * Horário e sentido seguem sendo auditados na nuvem — um leitor facial único
   * abre 24h ao reconhecer o rosto, então essas duas dimensões não dá para
   * impor por cadastro (precisariam ir para o agendamento do próprio aparelho).
   */
  private async categoriasPermitidasNoDispositivo(device: {
    id: number;
    id_condominio: number;
  }): Promise<Set<CategoriaPessoa> | null> {
    const regras = await this.prisma.regras_Acesso.findMany({
      where: {
        id_condominio: device.id_condominio,
        ativo: 1,
        dispositivos: { some: { id_dispositivo: device.id } },
      },
      select: {
        permitir_morador: true,
        permitir_visitante: true,
        permitir_prestador: true,
        permitir_funcionario: true,
      },
    });
    if (regras.length === 0) return null; // sem regras ativas = terminal liberado
    const set = new Set<CategoriaPessoa>();
    for (const r of regras) {
      if (r.permitir_morador === 1) set.add('morador');
      if (r.permitir_visitante === 1) set.add('visitante');
      if (r.permitir_prestador === 1) set.add('prestador');
      if (r.permitir_funcionario === 1) set.add('funcionario');
    }
    return set;
  }

  private categoriaAutorizada(
    permitidas: Set<CategoriaPessoa> | null,
    categoria: CategoriaPessoa,
  ): boolean {
    return permitidas === null || permitidas.has(categoria);
  }

  async syncMorador(idMorador: number, opts: { deviceIds?: number[]; cargaRestrita?: boolean } = {}) {
    if (FACIAL_DISABLED)
      return { skipped: true, reason: 'integration_disabled' };
    if (!this.prisma.isConnected) return { skipped: true, reason: 'no_db' };

    const morador = await this.prisma.moradores.findUnique({
      where: { id: idMorador },
    });
    if (!morador)
      throw new NotFoundException(`Morador ${idMorador} não encontrado`);

    // Biometria revogada pelo operador neste condomínio: foto nova não basta, só um novo aceite do
    // titular (ConsentimentosService.registrar limpa a marca). Os outros condomínios não têm a marca.
    const revogadoPeloOperador = morador.face_sync_error === REVOGADO_PELO_OPERADOR;

    // Sem data de nascimento não há como saber a idade: não enrola. Menor de
    // 18 anos só com o termo de consentimento do responsável (LGPD Art. 14),
    // aceito no app e gravado em extra2 — decisão do produto em 23/09/2026.
    if (
      !morador.data_nascimento ||
      (calcularIdade(morador.data_nascimento) < 18 && !temTermoResponsavel(morador.extra2))
    ) {
      this.logger.log(
        `Morador ${idMorador} menor de 18 anos ou sem data de nascimento comprovada: enrolamento facial não realizado.`,
      );
      if (morador.face_id && morador.id_condominio) {
        const removedOk = await this.unsyncMorador(idMorador, morador.face_id, morador.id_condominio);
        if (!removedOk) {
          // Mesmo contrato de syncVisitante/syncPessoa: remoção que não
          // chegou no aparelho não pode ser tratada como concluída — o
          // rosto continuaria abrindo a porta com o banco achando que já
          // tinha revogado.
          await this.prisma.moradores.update({
            where: { id: idMorador },
            data: { face_sync_status: 'pending' },
          });
          return { ok: false, removed: false, reason: 'remocao_pendente' };
        }
        await this.prisma.moradores.update({
          where: { id: idMorador },
          data: {
            face_id: null,
            face_sync_status: 'revoked',
            face_sync_error: revogadoPeloOperador ? REVOGADO_PELO_OPERADOR : 'menor_de_idade',
          },
        });
      }
      return { skipped: true, reason: 'menor_de_idade_ou_sem_comprovacao' };
    }

    // Biometria é dado sensível (Art. 11 da LGPD) e exige consentimento
    // específico e destacado. O app pede numa caixa separada, opcional.
    //
    // Esta checagem é o que faz aquela caixa valer: sem ela, o titular
    // recusaria e o rosto entraria no aparelho do mesmo jeito — aparência de
    // conformidade sem a substância, que é pior que não ter a caixa.
    //
    // Ausência de registro conta como NÃO autorizado.
    if (revogadoPeloOperador || !(await this.consentimentos.autorizouBiometria(morador.id_user))) {
      this.logger.log(
        revogadoPeloOperador
          ? `Morador ${idMorador} com biometria revogada pelo operador: enrolamento facial não realizado até novo consentimento do titular.`
          : `Morador ${idMorador} sem consentimento de biometria: enrolamento facial não realizado.`,
      );
      if (morador.face_id && morador.id_condominio) {
        const removedOk = await this.unsyncMorador(idMorador, morador.face_id, morador.id_condominio);
        if (!removedOk) {
          await this.prisma.moradores.update({
            where: { id: idMorador },
            data: { face_sync_status: 'pending' },
          });
          return { ok: false, removed: false, reason: 'remocao_pendente' };
        }
        await this.prisma.moradores.update({
          where: { id: idMorador },
          data: { face_id: null, face_sync_status: 'revoked' },
        });
      }
      return {
        skipped: true,
        reason: revogadoPeloOperador ? 'revogado_pelo_operador' : 'sem_consentimento_biometria',
      };
    }
    if (!morador.foto_pessoa) {
      // Foto removida do cadastro: se a pessoa já tinha rosto no aparelho,
      // REMOVE de todos os terminais — senão o morador continuaria abrindo com
      // um rosto órfão. E zera o face_id para não ser tratado como cadastrado.
      if (morador.face_id && morador.id_condominio) {
        const removedOk = await this.unsyncMorador(
          idMorador,
          morador.face_id,
          morador.id_condominio,
        );
        if (!removedOk) {
          await this.prisma.moradores.update({
            where: { id: idMorador },
            data: { face_sync_status: 'pending' },
          });
          return { ok: false, removed: false, reason: 'remocao_pendente' };
        }
        await this.prisma.moradores.update({
          where: { id: idMorador },
          data: { face_id: null, face_sync_status: null, face_sync_error: null, face_enrolled_at: null },
        });
        return { ok: true, removed: true };
      }
      return { skipped: true, reason: 'no_photo' };
    }
    if (!morador.id_condominio) {
      return { skipped: true, reason: 'no_condominio' };
    }

    // Só sincronizamos com terminais faciais — botoeira, catraca, leitores
    // de QR/RFID não têm endpoint de cadastro de pessoa (não recebem foto).
    // opts.deviceIds limita a quais terminais mandar (seleção no portal).
    const devices = await this.prisma.facial_Devices.findMany({
      where: {
        id_condominio: morador.id_condominio,
        ativo: 1,
        tipo: 'facial',
        ...(opts.deviceIds?.length ? { id: { in: opts.deviceIds } } : {}),
      },
    });
    if (devices.length === 0) {
      return { skipped: true, reason: 'no_facial_devices' };
    }

    const externalId = `morador_${morador.id}`;
    const fotoBase64 = await this.fetchPhotoAsBase64(morador.foto_pessoa);
    if (!fotoBase64) {
      await this.markMoradorSyncStatus(idMorador, 'error', 'Erro ao baixar foto do servidor de armazenamento.');
      return { ok: false, reason: 'photo_unreachable' };
    }

    const categoria: CategoriaPessoa =
      morador.tipo?.toLowerCase() === 'funcionario' ? 'funcionario' : 'morador';
    // Terminais de área com reserva obrigatória são geridos SÓ pelo motor de
    // reservas (syncReservaArea): morador não é enrolado por padrão aqui.
    const gatedAreaIds = await this.gatedAreaDeviceIds(morador.id_condominio);
    let faceId: string | null = morador.face_id ?? null;
    let allOk = true;
    let ultimoErro: string | null = null;
    const devicesSincronizados: number[] = [];
    for (const device of devices) {
      // Terminal de área gated: pula só MORADOR comum. Funcionário (administração)
      // sempre é enrolado — acessa qualquer terminal mesmo com a regra de reserva.
      if (gatedAreaIds.has(device.id) && categoria !== 'funcionario') continue;
      try {
        const permitidas = await this.categoriasPermitidasNoDispositivo(device);
        if (!this.categoriaAutorizada(permitidas, categoria)) {
          // A regra ATIVA do terminal não permite esta categoria: remove o rosto
          // do aparelho para que ele NEGUE fisicamente (não basta logar negado).
          await this.client.removePerson(
            this.toConfig(device),
            faceId ?? externalId,
          );
          continue;
        }
        if (faceId) {
          await this.client.updatePerson(this.toConfig(device), faceId, {
            nome: morador.nome,
            fotoBase64,
          });
        } else {
          const r = await this.client.enrollPerson(this.toConfig(device), {
            externalId,
            nome: morador.nome,
            fotoBase64,
          });
          faceId = r.faceId;
        }
        devicesSincronizados.push(device.id);
      } catch (err: any) {
        allOk = false;
        ultimoErro = err?.message ?? String(err);
        this.logger.warn(
          `Sync morador ${idMorador} device ${device.id} falhou: ${ultimoErro}`,
        );
      }
    }

    // Atualiza ultima_sincr dos devices que receberam a sync com sucesso —
    // não bloqueante: erros de update são logados mas não falham o sync.
    if (devicesSincronizados.length > 0) {
      const agora = new Date();
      this.prisma.facial_Devices
        .updateMany({
          where: { id: { in: devicesSincronizados } },
          data: { ultima_sincr: agora },
        })
        .catch((err) =>
          this.logger.warn(
            `Falha ao atualizar ultima_sincr (morador ${idMorador}): ${err?.message ?? err}`,
          ),
        );
    }

    const status = this.classificarSync(allOk, ultimoErro);
    if (this.preservarStatusGlobal(opts, allOk, morador.face_sync_status)) {
      return { ok: allOk, face_id: faceId, status, error: ultimoErro };
    }
    await this.prisma.moradores.update({
      where: { id: idMorador },
      data: {
        face_id: faceId,
        face_sync_status: status,
        face_sync_error: allOk ? null : (ultimoErro ? String(ultimoErro).slice(0, 500) : null),
        face_enrolled_at: allOk ? new Date() : morador.face_enrolled_at,
      },
    });

    return { ok: allOk, face_id: faceId, status, error: ultimoErro };
  }

  /**
   * Carga restrita a alguns terminais (terminal novo/reativado) que FALHOU para
   * quem já está 'synced': o status é global (por pessoa, não por aparelho) e
   * a pessoa continua válida nos outros terminais — rebaixá-la para 'pending'
   * fazia o back-fill recarregar todo mundo em todos os terminais. O que fica
   * pendente é o TERMINAL (`ultima_sincr = null`, ver syncAllForCondominio).
   */
  private preservarStatusGlobal(
    opts: { cargaRestrita?: boolean },
    allOk: boolean,
    statusAtual: string | null | undefined,
  ): boolean {
    return !!opts.cargaRestrita && !allOk && statusAtual === 'synced';
  }

  /**
   * Classifica o resultado de um sync por pessoa:
   *   synced  = deu certo
   *   error   = foto recusada pelo aparelho (sem rosto nítido) — não adianta
   *             re-tentar até trocar a foto
   *   pending = falha transitória (agente offline/timeout) — re-tenta sozinho
   */
  private classificarSync(
    allOk: boolean,
    ultimoErro: string | null,
  ): 'synced' | 'error' | 'pending' {
    if (allOk) return 'synced';
    const e = (ultimoErro ?? '').toLowerCase();
    if (/recus|bad request|sem rosto|\bface\b|rosto/.test(e)) return 'error';
    return 'pending';
  }

  /**
   * Formata uma data no padrão Dahua "YYYY-MM-DD HH:MM:SS", no fuso do
   * condomínio (Brasília). É a validade gravada no usuário do aparelho —
   * precisa bater com o relógio LOCAL do aparelho, que está em horário local.
   */
  private formatDahuaTime(d: Date): string {
    return d
      .toLocaleString('sv-SE', {
        timeZone: 'America/Sao_Paulo',
        hour12: false,
      })
      .replace(',', '');
  }

  /**
   * "YYYY-MM-DD 23:59:59" de HOJE em Brasília. Usado como teto de validade
   * gravado no aparelho para quem tem restrição de dias da semana: o terminal
   * nega SOZINHO a partir da meia-noite (mesmo offline), e o tick da virada
   * do dia / back-fill re-estende a validade nos dias autorizados.
   */
  private fimDoDiaBRT(): string {
    const hoje = new Date()
      .toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo', hour12: false })
      .slice(0, 10);
    return `${hoje} 23:59:59`;
  }

  // ==========================================================================
  // ÁREAS SOCIAIS — check-in por facial gated por reserva
  // ==========================================================================

  /** IDs dos terminais faciais de áreas com controle de acesso por reserva. */
  private async gatedAreaDeviceIds(idCondominio: number): Promise<Set<number>> {
    const areas = await this.prisma.areas_Sociais.findMany({
      where: { id_condominio: idCondominio, controle_acesso_facial: 1 },
      select: { id: true },
    });
    const areaIds = areas.map((a) => a.id);
    if (areaIds.length === 0) return new Set();
    const rows = await this.prisma.facial_Devices.findMany({
      where: {
        id_condominio: idCondominio,
        ativo: 1,
        tipo: 'facial',
        id_area_social: { in: areaIds },
      },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Janela "YYYY-MM-DD HH:MM:SS" (BRT, wall-clock) da reserva, montada direto
   * dos campos DATE + TIME (que já são horário local, sem timezone) — é o
   * formato que o aparelho espera. Ver formatDahuaTime (que é p/ instantes).
   *
   * Término 00:00 (o "24:00" do último bloco do app) ou sem hora é a
   * meia-noite do FIM do dia — mesma regra de `fimEmMinutos` da checagem de
   * reserva. Montado no mesmo dia, o fim ficava antes do início e o terminal
   * barrava o morador a reserva inteira.
   */
  private janelaReserva(ag: {
    data: Date | null;
    hora_de: Date | null;
    hora_ate: Date | null;
  }): { validFrom?: string; validTo?: string } {
    if (!ag.data) return {};
    const dia = ag.data.toISOString().slice(0, 10); // YYYY-MM-DD
    const hhmmss = (t: Date | null) => (t ? t.toISOString().slice(11, 19) : null);
    const de = hhmmss(ag.hora_de) ?? '00:00:00';
    const ateMin = ag.hora_ate ? ag.hora_ate.getUTCHours() * 60 + ag.hora_ate.getUTCMinutes() : 0;
    if (fimEmMinutos(ateMin) === 1440) {
      const diaSeguinte = new Date(ag.data.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return { validFrom: `${dia} ${de}`, validTo: `${diaSeguinte} 00:00:00` };
    }
    return { validFrom: `${dia} ${de}`, validTo: `${dia} ${hhmmss(ag.hora_ate)}` };
  }

  /**
   * A PRÓXIMA outra reserva aprovada vigente/futura do apartamento nesta área
   * (ou null). Devolve a reserva inteira, não um booleano, porque quem chama
   * precisa da JANELA dela para reescrever a validade gravada no aparelho.
   *
   * Por que a janela importa: o terminal guarda uma única janela por pessoa.
   * Quando a reserva atual é cancelada (manutenção, por exemplo) mas o apto
   * ainda tem outra reserva aprovada, apenas "não remover" deixava o aparelho
   * com a janela da reserva CANCELADA — e o morador entrava na área no meio da
   * manutenção. Reenrolar com a janela da reserva remanescente fecha o buraco
   * sem tirar o acesso a que ele ainda tem direito.
   */
  private async proximaOutraReservaAprovada(
    idArea: number,
    idApto: number,
    excluirAgId: number,
  ) {
    // "Hoje" no fuso do condomínio — o servidor roda em UTC e, depois das 21h
    // locais, `new Date()` já virou o dia seguinte lá: uma reserva de hoje
    // sairia da janela e o acesso seria revogado cedo demais.
    const hojeStr = new Date()
      .toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo', hour12: false })
      .slice(0, 10);
    return this.prisma.areas_Sociais_Agendamentos.findFirst({
      where: {
        id_area_social: idArea,
        id_apartamento: idApto,
        status: 'aprovado',
        NOT: { id: excluirAgId },
        data: { gte: new Date(hojeStr) },
      },
      orderBy: [{ data: 'asc' }, { hora_de: 'asc' }],
    });
  }

  /**
   * Enrola/remove os moradores do apartamento no(s) terminal(is) facial(is) da
   * área conforme o status da reserva. Aprovado → enrola com a janela do
   * horário (o aparelho nega sozinho fora dela). Recusado/cancelado → remove;
   * se o apto ainda tiver OUTRA reserva aprovada, reenrola com a janela dela
   * (nunca deixa a janela da reserva perdida no aparelho). Fire-and-forget.
   */
  async syncReservaArea(idAgendamento: number) {
    if (FACIAL_DISABLED) return { skipped: true, reason: 'integration_disabled' };
    if (!this.prisma.isConnected) return { skipped: true, reason: 'no_db' };

    const ag = await this.prisma.areas_Sociais_Agendamentos.findUnique({
      where: { id: Number(idAgendamento) },
      include: { area: { select: { id_condominio: true, controle_acesso_facial: true } } },
    });
    if (!ag || !ag.area) return { skipped: true, reason: 'not_found' };
    if (ag.area.controle_acesso_facial !== 1) return { skipped: true, reason: 'area_sem_controle' };
    const idCond = ag.area.id_condominio;

    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_area_social: ag.id_area_social, ativo: 1, tipo: 'facial' },
    });
    if (devices.length === 0) return { skipped: true, reason: 'no_area_device' };

    // Moradores do apartamento (com foto) que reservou.
    const vinculos = await this.prisma.apartamentos_Users.findMany({
      where: { id_apto: ag.id_apartamento },
      select: { id_user: true },
    });
    const userIds = vinculos.map((v) => v.id_user);
    const moradores = userIds.length
      ? await this.prisma.moradores.findMany({
          where: { id_user: { in: userIds }, id_condominio: idCond },
        })
      : [];

    const aprovado = ag.status === 'aprovado';
    // Reserva perdida (recusada/cancelada): o apto pode ainda ter OUTRA reserva
    // aprovada. Nesse caso não basta "não remover" — é preciso REESCREVER a
    // janela do aparelho para a da reserva remanescente, senão o terminal
    // continua abrindo no horário da reserva que acabou de ser cancelada
    // (exatamente o furo de "manutenção com a catraca aberta").
    const reservaRemanescente = !aprovado
      ? await this.proximaOutraReservaAprovada(ag.id_area_social, ag.id_apartamento, ag.id)
      : null;
    // A janela gravada é sempre a da reserva que de fato dá direito de entrar.
    const { validFrom, validTo } = this.janelaReserva(
      aprovado ? ag : (reservaRemanescente ?? ag),
    );

    // Biometria revogada pelo operador neste condomínio (marca na linha) ou recusada pelo titular: a
    // reserva não dá rosto no terminal da área — mesma regra do syncMorador para os outros terminais.
    const semBiometria = new Set<number>();
    for (const m of moradores) {
      if (
        m.face_sync_error === REVOGADO_PELO_OPERADOR ||
        !(await this.consentimentos.autorizouBiometria(m.id_user))
      ) {
        semBiometria.add(m.id);
      }
    }

    for (const device of devices) {
      for (const m of moradores) {
        const externalId = `morador_${m.id}`;
        try {
          if (semBiometria.has(m.id)) {
            // Remove também com a reserva aprovada: um rosto de reserva anterior ainda pode estar lá.
            await this.client.removePerson(this.toConfig(device), m.face_id ?? externalId);
            continue;
          }
          if (aprovado || reservaRemanescente) {
            // Sem foto utilizável não dá para (re)enrolar. Quando a reserva
            // atual foi perdida, cair fora sem fazer nada deixaria a janela
            // velha no aparelho — então aqui a saída segura é REMOVER (quem
            // não tem foto não tem acesso facial nenhum de qualquer forma; o
            // tick de reservas re-enrola assim que houver foto).
            const fotoBase64 = m.foto_pessoa ? await this.fetchPhotoAsBase64(m.foto_pessoa) : null;
            if (!fotoBase64) {
              if (aprovado) continue;
              await this.client.removePerson(this.toConfig(device), m.face_id ?? externalId);
              continue;
            }
            await this.client.enrollPerson(this.toConfig(device), {
              externalId,
              nome: m.nome,
              fotoBase64,
              validFrom,
              validTo,
              userTimes: -1,
            });
          } else {
            await this.client.removePerson(
              this.toConfig(device),
              m.face_id ?? externalId,
            );
          }
        } catch (err: any) {
          this.logger.warn(
            `syncReservaArea ag ${idAgendamento} morador ${m.id} device ${device.id}: ${err?.message ?? err}`,
          );
        }
      }
    }
    return {
      ok: true,
      devices: devices.length,
      moradores: moradores.length,
      aprovado,
      // Reenrolado com a janela de outra reserva aprovada do apto.
      reenroladoComOutraReserva: !aprovado && !!reservaRemanescente,
    };
  }

  /**
   * Reconciliação periódica: re-enrola (idempotente) as reservas APROVADAS de
   * hoje cujo horário ainda não terminou — cobre pré-enrolamento e re-tentativa
   * quando o agente estava offline na aprovação. Cleanup pós-horário é feito
   * pelo próprio aparelho (validTo). Espelha os demais ticks.
   */
  private async tickReservasAreas() {
    if (FACIAL_DISABLED || !this.prisma.isConnected) return;
    try {
      const agoraStr = new Date()
        .toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo', hour12: false })
        .replace(',', '');
      const ags = await this.prisma.areas_Sociais_Agendamentos.findMany({
        where: {
          status: 'aprovado',
          // "Hoje" em Brasília (meia-noite UTC, a forma do @db.Date): o dia
          // UTC já é amanhã depois das 21h locais.
          data: hojeBrasilia(),
          area: {
            controle_acesso_facial: 1,
            devices: { some: { ativo: 1, tipo: 'facial' } },
          },
        },
        select: { id: true, data: true, hora_de: true, hora_ate: true },
      });
      let processados = 0;
      for (const ag of ags) {
        const { validTo } = this.janelaReserva(ag);
        // Já terminou hoje? aparelho já nega sozinho — não gasta ciclo.
        if (validTo && validTo < agoraStr) continue;
        await this.syncReservaArea(ag.id).catch((e) =>
          this.logger.warn(`tickReservasAreas ag ${ag.id}: ${e?.message ?? e}`),
        );
        processados++;
      }
      if (processados > 0) {
        this.logger.log(`tickReservasAreas: ${processados} reserva(s) sincronizada(s)`);
      }
    } catch (e: any) {
      this.logger.warn(`tickReservasAreas erro: ${e?.message ?? e}`);
    }
  }

  async syncVisitante(idVisitante: number, opts: { deviceIds?: number[]; cargaRestrita?: boolean } = {}) {
    if (FACIAL_DISABLED)
      return { skipped: true, reason: 'integration_disabled' };
    if (!this.prisma.isConnected) return { skipped: true, reason: 'no_db' };

    if (pessoasMigrationEnabled(this.prisma)) {
      const visita = await this.prisma.visitas.findUnique({
        where: { id: idVisitante },
        select: { id_pessoa: true },
      });
      if (visita) {
        return this.syncPessoa(visita.id_pessoa, opts);
      }
      // Critical 3 (Lote B): com a flag ligada, `idVisitante` é sempre um id
      // de `Visitas` — nunca resolvido contra `Visitantes`. Cair para lá
      // colidiria com o `Visitantes.id` de outra pessoa (os dois
      // autoincrement nascem do 1) e sincronizaria/desinscreveria o rosto de
      // quem nunca foi chamado. Sem Visita para este id, não há o que
      // sincronizar.
      return { skipped: true, reason: 'visita_nao_encontrada' };
    }

    const visitante = await this.prisma.visitantes.findUnique({
      where: { id: idVisitante },
    });
    if (!visitante)
      throw new NotFoundException(`Visitante ${idVisitante} não encontrado`);
    if (!visitante.foto_pessoa) {
      // Foto removida: remove o rosto órfão do aparelho e zera o face_id.
      if (visitante.face_id && visitante.id_condominio) {
        const removedOk = await this.unsyncVisitante(
          idVisitante,
          visitante.face_id,
          visitante.id_condominio,
        );
        if (!removedOk) {
          // Remoção não chegou a todos os terminais (agente/terminal offline).
          // MANTÉM o face_id com status 'pending' — o back-fill do reconnect
          // re-executa este sync e re-tenta a remoção.
          await this.prisma.visitantes.update({
            where: { id: idVisitante },
            data: { face_sync_status: 'pending' },
          });
          return { ok: false, removed: false, reason: 'remocao_pendente' };
        }
        await this.prisma.visitantes.update({
          where: { id: idVisitante },
          data: { face_id: null, face_sync_status: null, face_sync_error: null, face_enrolled_at: null },
        });
        return { ok: true, removed: true };
      }
      return { skipped: true, reason: 'no_photo' };
    }

    // Biometria é dado sensível (Art. 11 da LGPD) e o titular aqui não tem
    // conta no sistema: quem cadastrou é que declara ter colhido a autorização
    // e a maioridade. Sem declaração, o visitante entra normalmente — por PIN,
    // interfone ou liberação da portaria — só não vai rosto para o terminal.
    //
    // A checagem vem DEPOIS do bloco de remoção acima de propósito: rosto que
    // já está no aparelho e perdeu a foto continua sendo removido.
    if (
      !(await this.consentimentosTerceiros.autorizouBiometria({
        idCondominio: visitante.id_condominio,
        tipoPessoa: visitante.is_prestador === 1 ? 'prestador' : 'visitante',
        idPessoa: visitante.id,
        doc: visitante.doc_identificacao,
      }))
    ) {
      this.logger.log(
        `Visitante ${idVisitante} sem declaração de consentimento biométrico: enrolamento facial não realizado.`,
      );
      return { skipped: true, reason: 'sem_consentimento_biometria' };
    }

    // O rosto do visitante só fica no aparelho enquanto ele está AUTORIZADO —
    // liberado=1 E dentro da janela de validade, OU atualmente DENTRO (entrou e
    // ainda não saiu, p/ poder sair). Sem isso, um visitante já sem liberação
    // (ou expirado) seria reconhecido e o aparelho ABRIRIA, mesmo a nuvem
    // negando. Prestador (liberado fixo=1) permanece enquanto na janela.
    const agora = Date.now();
    const inicioMs = visitante.data_hora_inicio
      ? new Date(visitante.data_hora_inicio).getTime()
      : null;
    const terminoMs = visitante.data_hora_termino
      ? new Date(visitante.data_hora_termino).getTime()
      : null;
    const GRACE = 15 * 60 * 1000;
    const dentroJanela =
      (inicioMs === null || agora >= inicioMs - GRACE) &&
      (terminoMs === null || agora <= terminoMs + GRACE);

    // Considera "dentro do condomínio" apenas se entrou e ainda não registrou saída,
    // e desde que a entrada tenha ocorrido há menos de 24 horas (proteção contra estado órfão).
    const VINTE_QUATRO_HORAS_MS = 24 * 60 * 60 * 1000;
    const tempoMaximoCondominio = visitante.data_entrada
      ? agora - new Date(visitante.data_entrada).getTime() < VINTE_QUATRO_HORAS_MS
      : false;
    const dentroDoCondominio =
      !!visitante.data_entrada && !visitante.data_saida && tempoMaximoCondominio;
    // Restrição de dia da semana configurada na ficha do prestador/visitante.
    // Usa horário de Brasília para bater com o relógio do aparelho.
    const mapDiasSemana = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
    const agoraBRT = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
    );
    const diaSemanaAtual = mapDiasSemana[agoraBRT.getDay()];
    const diasPermitidos: string[] = visitante.dias_semana
      ? (visitante.dias_semana as string)
          .split(',')
          .map((d) => d.trim().toLowerCase())
          .filter(Boolean)
      : [];
    const diaAutorizado =
      diasPermitidos.length === 0 || diasPermitidos.includes(diaSemanaAtual);
    // dentroDoCondominio sempre permite (pessoa dentro pode sair mesmo fora do dia autorizado).
    const autorizado =
      visitante.bloqueado !== 1 &&
      ((visitante.liberado === 1 && dentroJanela && diaAutorizado) ||
        dentroDoCondominio);
    if (!autorizado) {
      if (visitante.face_id && visitante.id_condominio) {
        const removedOk = await this.unsyncVisitante(
          idVisitante,
          visitante.face_id,
          visitante.id_condominio,
        );
        if (!removedOk) {
          // Revogação (saída/expiração/bloqueio) não chegou ao aparelho.
          // Mantém face_id + 'pending' para o back-fill do reconnect remover
          // — sem isso a pessoa revogada continuaria abrindo fisicamente.
          await this.prisma.visitantes.update({
            where: { id: idVisitante },
            data: { face_sync_status: 'pending' },
          });
          return { ok: false, removed: false, reason: 'remocao_pendente' };
        }
        await this.prisma.visitantes.update({
          where: { id: idVisitante },
          data: { face_id: null, face_sync_status: null, face_sync_error: null, face_enrolled_at: null },
        });
        return { ok: true, removed: true, reason: 'nao_autorizado' };
      }
      return { skipped: true, reason: 'nao_autorizado' };
    }

    // Só terminais faciais recebem cadastro de pessoa (foto + face_id).
    // Botoeira/catraca/QR/RFID não armazenam biometria. opts.deviceIds limita.
    const devices = await this.prisma.facial_Devices.findMany({
      where: {
        id_condominio: visitante.id_condominio,
        ativo: 1,
        tipo: 'facial',
        ...(opts.deviceIds?.length ? { id: { in: opts.deviceIds } } : {}),
      },
    });
    if (devices.length === 0) {
      return { skipped: true, reason: 'no_facial_devices' };
    }

    const externalId = `visitante_${visitante.id}`;
    const fotoBase64 = await this.fetchPhotoAsBase64(visitante.foto_pessoa);
    if (!fotoBase64) {
      await this.markVisitanteSyncStatus(idVisitante, 'error', 'Erro ao baixar foto do servidor de armazenamento.');
      return { ok: false, reason: 'photo_unreachable' };
    }

    const categoria: CategoriaPessoa =
      visitante.is_prestador === 1 ? 'prestador' : 'visitante';
    // Validade gravada NO APARELHO (ele nega sozinho após o término, sem
    // depender da nuvem). Sem janela = permanente (prestador). Ver formatDahuaTime.
    const validFrom = visitante.data_hora_inicio
      ? this.formatDahuaTime(new Date(visitante.data_hora_inicio))
      : undefined;
    // Se a pessoa está DENTRO do condomínio mas a janela já expirou, NÃO enviar
    // o ValidTo vencido ao aparelho — o aparelho negaria saída mesmo sendo legítima.
    // A nuvem já auditará o evento independente. Sem janela = permanente.
    let validTo =
      dentroDoCondominio && !dentroJanela
        ? undefined
        : visitante.data_hora_termino
          ? this.formatDahuaTime(new Date(visitante.data_hora_termino))
          : undefined;
    // Restrição de dias da semana aplicada NO APARELHO: teto de validade no
    // fim do dia atual. Amanhã (dia possivelmente não autorizado) o terminal
    // nega sozinho, mesmo offline; o tick da virada do dia re-estende quando
    // o dia for permitido. Não se aplica a quem está DENTRO do condomínio —
    // capar a validade impediria a saída após a meia-noite.
    if (!dentroDoCondominio && diasPermitidos.length > 0) {
      const fimHoje = this.fimDoDiaBRT();
      // Strings "YYYY-MM-DD HH:MM:SS" comparam cronologicamente.
      validTo = !validTo || validTo > fimHoje ? fimHoje : validTo;
    }
    // Visitante com VAGA ativa (o morador reservou uma vaga p/ o carro dele)
    // pode entrar/sair quantas vezes quiser na janela — como prestador, UseTime
    // ilimitado. Sem isso, o contador (2 = entra+sai) esgota após a 1ª saída e
    // ele não consegue reentrar mesmo dentro da validade.
    const temVagaAtiva =
      (await this.prisma.vagas.count({
        where: { id_visitante: visitante.id, ativo: 1, ...whereVagaVigente() },
      })) > 0;

    let faceId: string | null = visitante.face_id ?? null;
    let allOk = true;
    let ultimoErro: string | null = null;
    const devicesSincronizados: number[] = [];
    for (const device of devices) {
      try {
        const permitidas = await this.categoriasPermitidasNoDispositivo(device);
        if (!this.categoriaAutorizada(permitidas, categoria)) {
          await this.client.removePerson(
            this.toConfig(device),
            faceId ?? externalId,
          );
          continue;
        }

        // Se a pessoa está expirada ou não-liberada, e está dentro do condomínio:
        // - Pode ficar nos dispositivos de SAÍDA (sentido === 'saida') para poder sair.
        // - Não deve ficar nos dispositivos de ENTRADA (sentido === 'entrada') ou AUTO (sentido === 'auto')
        //   porque senão ela conseguiria entrar fisicamente estando expirada.
        const liberadoGeral =
          visitante.liberado === 1 && dentroJanela && diaAutorizado;
        const podeEstarNoDispositivo =
          liberadoGeral || (dentroDoCondominio && device.sentido === 'saida');

        if (!podeEstarNoDispositivo) {
          await this.client.removePerson(
            this.toConfig(device),
            faceId ?? externalId,
          );
          continue;
        }

        // Limite de usos gravado NO APARELHO (UseTime; ele decrementa e nega
        // sozinho, mesmo offline). O aparelho decrementa por RECONHECIMENTO, e
        // uma única aproximação dispara vários frames — a entrada pode queimar
        // mais de 1 uso. Por isso o re-sync pós-entrada regrava o contador:
        // dentro do condomínio só resta a SAÍDA → exatamente 1 uso.
        // Prestador e visitante-com-vaga: usos ILIMITADOS (-1) — entram/saem
        // livremente dentro da janela. Visitante comum: contador limitado.
        let userTimes = -1;
        if (visitante.is_prestador !== 1 && !temVagaAtiva) {
          if (dentroDoCondominio) userTimes = 1;
          else userTimes = device.sentido === 'auto' ? 2 : 1;
        }

        if (faceId) {
          await this.client.updatePerson(this.toConfig(device), faceId, {
            nome: visitante.nome,
            fotoBase64,
            validFrom,
            validTo,
            userTimes,
          });
        } else {
          const r = await this.client.enrollPerson(this.toConfig(device), {
            externalId,
            nome: visitante.nome,
            fotoBase64,
            validFrom,
            validTo,
            userTimes,
          });
          faceId = r.faceId;
        }
        devicesSincronizados.push(device.id);
      } catch (err: any) {
        allOk = false;
        ultimoErro = err?.message ?? String(err);
        this.logger.warn(
          `Sync visitante ${idVisitante} device ${device.id} falhou: ${ultimoErro}`,
        );
      }
    }

    // Mesma lógica de atualização de ultima_sincr do syncMorador.
    if (devicesSincronizados.length > 0) {
      const agora = new Date();
      this.prisma.facial_Devices
        .updateMany({
          where: { id: { in: devicesSincronizados } },
          data: { ultima_sincr: agora },
        })
        .catch((err) =>
          this.logger.warn(
            `Falha ao atualizar ultima_sincr (visitante ${idVisitante}): ${err?.message ?? err}`,
          ),
        );
    }

    const status = this.classificarSync(allOk, ultimoErro);
    if (this.preservarStatusGlobal(opts, allOk, visitante.face_sync_status)) {
      return { ok: allOk, face_id: faceId, status, error: ultimoErro };
    }
    await this.prisma.visitantes.update({
      where: { id: idVisitante },
      data: {
        face_id: faceId,
        face_sync_status: status,
        face_sync_error: allOk ? null : (ultimoErro ? String(ultimoErro).slice(0, 500) : null),
        face_enrolled_at: allOk ? new Date() : visitante.face_enrolled_at,
      },
    });

    return { ok: allOk, face_id: faceId, status, error: ultimoErro };
  }

  /**
   * Remove o rosto do morador dos terminais. Devolve `true` só quando TODAS as
   * remoções deram certo — mesmo contrato do `unsyncVisitante`, e por isso
   * mesmo: numa revogação de consentimento, "tentei apagar" não é "apaguei".
   * Com `false`, quem chamou deve manter o face_id em 'pending' para o
   * back-fill do reconnect re-tentar, senão a revogação se perde e a pessoa
   * continua abrindo a porta fisicamente.
   */
  async unsyncMorador(
    idMorador: number,
    faceId: string | null,
    idCondominio: number | null,
    opts: { deviceIds?: number[] } = {},
  ): Promise<boolean> {
    if (FACIAL_DISABLED || !faceId || !idCondominio) return true;
    // Mesmo critério do sync: só terminais faciais têm /persons.
    const devices = await this.prisma.facial_Devices.findMany({
      where: {
        id_condominio: idCondominio,
        ativo: 1,
        tipo: 'facial',
        ...(opts.deviceIds?.length ? { id: { in: opts.deviceIds } } : {}),
      },
    });
    let allOk = true;
    for (const device of devices) {
      try {
        await this.client.removePerson(this.toConfig(device), faceId);
      } catch (err: any) {
        allOk = false;
        this.logger.warn(
          `Remoção morador ${idMorador} device ${device.id}: ${err?.message ?? err}`,
        );
      }
    }
    return allOk;
  }

  /**
   * Remove o rosto do visitante dos terminais. Retorna `true` só quando TODAS
   * as remoções deram certo — o chamador usa isso para decidir se pode zerar
   * o face_id no banco. Se alguma falhou (agente offline, terminal fora),
   * quem chamou deve manter o face_id com status 'pending' para o back-fill
   * do reconnect re-tentar a remoção (senão a revogação se perde e a pessoa
   * continua abrindo a porta fisicamente).
   */
  async unsyncVisitante(
    idVisitante: number,
    faceId: string | null,
    idCondominio: number,
    opts: { deviceIds?: number[] } = {},
  ): Promise<boolean> {
    if (FACIAL_DISABLED || !faceId) return true;
    // Mesmo critério do sync: só terminais faciais têm /persons.
    const devices = await this.prisma.facial_Devices.findMany({
      where: {
        id_condominio: idCondominio,
        ativo: 1,
        tipo: 'facial',
        ...(opts.deviceIds?.length ? { id: { in: opts.deviceIds } } : {}),
      },
    });
    let allOk = true;
    for (const device of devices) {
      try {
        await this.client.removePerson(this.toConfig(device), faceId);
      } catch (err: any) {
        allOk = false;
        this.logger.warn(
          `Remoção visitante ${idVisitante} device ${device.id}: ${err?.message ?? err}`,
        );
      }
    }
    return allOk;
  }

  /**
   * Remove o rosto da Pessoa física dos terminais.
   */
  async unsyncPessoa(
    idPessoa: number,
    faceId: string | null,
    idCondominio: number,
    opts: { deviceIds?: number[] } = {},
  ): Promise<boolean> {
    if (FACIAL_DISABLED || !faceId) return true;
    const devices = await this.prisma.facial_Devices.findMany({
      where: {
        id_condominio: idCondominio,
        ativo: 1,
        tipo: 'facial',
        ...(opts.deviceIds?.length ? { id: { in: opts.deviceIds } } : {}),
      },
    });
    let allOk = true;
    for (const device of devices) {
      try {
        await this.client.removePerson(this.toConfig(device), faceId);
      } catch (err: any) {
        allOk = false;
        this.logger.warn(
          `Remoção pessoa ${idPessoa} device ${device.id}: ${err?.message ?? err}`,
        );
      }
    }
    return allOk;
  }

  /**
   * Sincroniza a Pessoa (visitante/prestador unificado) com os terminais faciais.
   * O rosto só permanece ativo no terminal se houver pelo menos uma visita válida no momento.
   */
  async syncPessoa(idPessoa: number, opts: { deviceIds?: number[]; cargaRestrita?: boolean } = {}) {
    if (FACIAL_DISABLED) return { skipped: true, reason: 'integration_disabled' };
    if (!this.prisma.isConnected) return { skipped: true, reason: 'no_db' };

    const pessoa = await this.prisma.pessoas.findUnique({
      where: { id: Number(idPessoa) },
      include: { visitas: true },
    });
    if (!pessoa) throw new NotFoundException(`Pessoa ${idPessoa} não encontrada`);

    if (!pessoa.foto_pessoa) {
      if (pessoa.face_id && pessoa.id_condominio) {
        const removedOk = await this.unsyncPessoa(idPessoa, pessoa.face_id, pessoa.id_condominio, opts);
        if (!removedOk) {
          // Mesma regra de syncVisitante: se a remoção não chegou no
          // aparelho, mantém face_id + 'pending' pro reconnect tentar de
          // novo — senão o rosto fica ativo no terminal pra sempre e a nuvem
          // acha que já revogou.
          await this.prisma.pessoas.update({
            where: { id: idPessoa },
            data: { face_sync_status: 'pending' },
          });
          return { ok: false, removed: false, reason: 'remocao_pendente' };
        }
        await this.prisma.pessoas.update({
          where: { id: idPessoa },
          data: { face_id: null, face_sync_status: null, face_sync_error: null },
        });
        return { ok: true, syncState: 'revoked' };
      }
      return { skipped: true, reason: 'no_photo' };
    }

    // Biometria é dado sensível (Art. 11 da LGPD) e o titular aqui não tem
    // conta no sistema: quem cadastrou é que declara ter colhido a
    // autorização, igual ao caminho legado de Visitantes (syncVisitante,
    // linhas ~1762-1774) — sem essa checagem, o rosto ia pro terminal mesmo
    // sem a declaração, e a caixa de consentimento da tela virava decorativa.
    // Busca por documento primeiro (mesma pessoa que já declarou antes,
    // inclusive pelo caminho legado, não precisa declarar de novo).
    if (
      !(await this.consentimentosTerceiros.autorizouBiometria({
        idCondominio: pessoa.id_condominio,
        tipoPessoa: pessoa.tipo_pessoa === 'prestador' ? 'prestador' : 'visitante',
        idPessoa: pessoa.id,
        doc: pessoa.doc_identificacao,
      }))
    ) {
      this.logger.log(
        `Pessoa ${idPessoa} sem declaração de consentimento biométrico: enrolamento facial não realizado.`,
      );
      if (pessoa.face_id && pessoa.id_condominio) {
        const removedOk = await this.unsyncPessoa(idPessoa, pessoa.face_id, pessoa.id_condominio, opts);
        if (!removedOk) {
          await this.prisma.pessoas.update({
            where: { id: idPessoa },
            data: { face_sync_status: 'pending' },
          });
          return { ok: false, removed: false, reason: 'remocao_pendente' };
        }
        await this.prisma.pessoas.update({
          where: { id: idPessoa },
          data: { face_id: null, face_sync_status: null, face_sync_error: null },
        });
      }
      return { skipped: true, reason: 'sem_consentimento_biometria' };
    }

    const agora = Date.now();
    const GRACE = 15 * 60 * 1000;
    const VINTE_QUATRO_HORAS_MS = 24 * 60 * 60 * 1000;
    const mapDiasSemana = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
    const agoraBRT = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
    );
    const diaSemanaAtual = mapDiasSemana[agoraBRT.getDay()];

    const visitas = pessoa.visitas ?? [];
    const autorizado =
      pessoa.bloqueado !== 1 &&
      visitas.some((v) => {
        if (v.bloqueado === 1 || v.liberado !== 1) return false;
        const inicioMs = v.data_hora_inicio ? new Date(v.data_hora_inicio).getTime() : null;
        const terminoMs = v.data_hora_termino ? new Date(v.data_hora_termino).getTime() : null;
        const dentroJanela =
          (inicioMs === null || agora >= inicioMs - GRACE) &&
          (terminoMs === null || agora <= terminoMs + GRACE);
        const dentroDoCondominio =
          !!v.data_entrada &&
          !v.data_saida &&
          agora - new Date(v.data_entrada).getTime() < VINTE_QUATRO_HORAS_MS;
        const diasPermitidos: string[] = v.dias_semana
          ? v.dias_semana.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
          : [];
        const diaAutorizado = diasPermitidos.length === 0 || diasPermitidos.includes(diaSemanaAtual);
        return (dentroJanela && diaAutorizado) || dentroDoCondominio;
      });

    if (!autorizado) {
      if (pessoa.face_id && pessoa.id_condominio) {
        const removedOk = await this.unsyncPessoa(idPessoa, pessoa.face_id, pessoa.id_condominio, opts);
        if (!removedOk) {
          // Idem: revogação (bloqueio/expiração) que não chegou no aparelho
          // não pode ser tratada como concluída — o rosto continuaria
          // abrindo fisicamente enquanto a nuvem acha que já revogou.
          await this.prisma.pessoas.update({
            where: { id: idPessoa },
            data: { face_sync_status: 'pending' },
          });
          return { ok: false, removed: false, reason: 'remocao_pendente' };
        }
        await this.prisma.pessoas.update({
          where: { id: idPessoa },
          data: { face_sync_status: 'revoked' },
        });
        return { ok: true, syncState: 'revoked' };
      }
      return { ok: true, syncState: 'inactive' };
    }

    return this.pushPessoaToDevices(pessoa, opts);
  }

  /**
   * Acha, dentre as visitas incluídas na Pessoa, a que está autorizando o
   * acesso agora — mesmo critério de `syncPessoa` (janela + dia da semana,
   * ou já dentro do condomínio). É dela que a janela de validade gravada NO
   * APARELHO é derivada; sem uma visita ativa a pessoa fica sem janela
   * nenhuma (permanente), que é o ponto do Finding 4.
   */
  private resolverVisitaAtivaPessoa(pessoa: any): any | null {
    const agora = Date.now();
    const GRACE = 15 * 60 * 1000;
    const VINTE_QUATRO_HORAS_MS = 24 * 60 * 60 * 1000;
    const mapDiasSemana = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
    const agoraBRT = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
    );
    const diaSemanaAtual = mapDiasSemana[agoraBRT.getDay()];
    const visitas: any[] = pessoa.visitas ?? [];

    return (
      visitas.find((v) => {
        if (v.bloqueado === 1 || v.liberado !== 1) return false;
        const inicioMs = v.data_hora_inicio ? new Date(v.data_hora_inicio).getTime() : null;
        const terminoMs = v.data_hora_termino ? new Date(v.data_hora_termino).getTime() : null;
        const dentroJanela =
          (inicioMs === null || agora >= inicioMs - GRACE) &&
          (terminoMs === null || agora <= terminoMs + GRACE);
        const dentroDoCondominio =
          !!v.data_entrada &&
          !v.data_saida &&
          agora - new Date(v.data_entrada).getTime() < VINTE_QUATRO_HORAS_MS;
        const diasPermitidos: string[] = v.dias_semana
          ? v.dias_semana.split(',').map((d: string) => d.trim().toLowerCase()).filter(Boolean)
          : [];
        const diaAutorizado = diasPermitidos.length === 0 || diasPermitidos.includes(diaSemanaAtual);
        return (dentroJanela && diaAutorizado) || dentroDoCondominio;
      }) ?? null
    );
  }

  /**
   * Com a flag ligada, `tickDiasSemanaSync`, `tickExpiracaoAutomatica` e
   * `tickPreEnrolamento` também chamam `syncPessoa` — é o `tickDiasSemanaSync`,
   * na hora 0 BRT, que reestende o teto de validade de fim-de-dia que
   * `dias_semana` impõe (ver `fimDoDiaBRT` abaixo).
   *
   * TODO (não corrigido nesta rodada — documentado para quem terminar a
   * migração): quando uma Pessoa tem várias Visitas ativas sobrepostas,
   * `resolverVisitaAtivaPessoa` usa `.find(...)` sobre `pessoa.visitas`
   * (populado por `include: { visitas: true }` sem `orderBy`) — a ordem de
   * retorno do banco decide qual visita "vence", então a janela mais estreita
   * pode ganhar e travar a pessoa fora mais cedo do que qualquer uma das
   * visitas isoladamente permitiria.
   */
  async pushPessoaToDevices(pessoa: any, opts: { deviceIds?: number[]; cargaRestrita?: boolean } = {}) {
    const devices = await this.prisma.facial_Devices.findMany({
      where: {
        id_condominio: pessoa.id_condominio,
        ativo: 1,
        tipo: 'facial',
        ...(opts.deviceIds?.length ? { id: { in: opts.deviceIds } } : {}),
      },
    });
    if (devices.length === 0) {
      return { skipped: true, reason: 'no_facial_devices' };
    }

    const externalId = `pessoa_${pessoa.id}`;
    const fotoBase64 = await this.fetchPhotoAsBase64(pessoa.foto_pessoa);
    if (!fotoBase64) {
      await this.prisma.pessoas.update({
        where: { id: pessoa.id },
        data: { face_sync_status: 'error', face_sync_error: 'Erro ao baixar foto.' },
      });
      return { ok: false, reason: 'photo_unreachable' };
    }

    // Janela de validade e limite de usos NO APARELHO — mesmo princípio do
    // syncVisitante (ver linhas ~1845-1923): sem isso a pessoa fica enrolada
    // permanentemente, sem expiração nenhuma no terminal.
    const visitaAtiva = this.resolverVisitaAtivaPessoa(pessoa);
    const agora = Date.now();
    const VINTE_QUATRO_HORAS_MS = 24 * 60 * 60 * 1000;
    const dentroDoCondominio = !!(
      visitaAtiva?.data_entrada &&
      !visitaAtiva?.data_saida &&
      agora - new Date(visitaAtiva.data_entrada).getTime() < VINTE_QUATRO_HORAS_MS
    );
    const inicioMs = visitaAtiva?.data_hora_inicio
      ? new Date(visitaAtiva.data_hora_inicio).getTime()
      : null;
    const terminoMs = visitaAtiva?.data_hora_termino
      ? new Date(visitaAtiva.data_hora_termino).getTime()
      : null;
    const GRACE = 15 * 60 * 1000;
    const dentroJanela =
      (inicioMs === null || agora >= inicioMs - GRACE) &&
      (terminoMs === null || agora <= terminoMs + GRACE);

    const mapDiasSemana = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
    const agoraBRT = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
    );
    const diaSemanaAtual = mapDiasSemana[agoraBRT.getDay()];
    const diasPermitidos: string[] = visitaAtiva?.dias_semana
      ? String(visitaAtiva.dias_semana).split(',').map((d: string) => d.trim().toLowerCase()).filter(Boolean)
      : [];
    const diaAutorizado = diasPermitidos.length === 0 || diasPermitidos.includes(diaSemanaAtual);

    const validFrom = visitaAtiva?.data_hora_inicio
      ? this.formatDahuaTime(new Date(visitaAtiva.data_hora_inicio))
      : undefined;
    let validTo =
      dentroDoCondominio && !dentroJanela
        ? undefined
        : visitaAtiva?.data_hora_termino
          ? this.formatDahuaTime(new Date(visitaAtiva.data_hora_termino))
          : undefined;
    if (!dentroDoCondominio && diasPermitidos.length > 0) {
      const fimHoje = this.fimDoDiaBRT();
      validTo = !validTo || validTo > fimHoje ? fimHoje : validTo;
    }

    // A categoria (pra userTimes) vem da AUTORIZAÇÃO ativa (Visitas.is_prestador),
    // não da identidade (Pessoas.tipo_pessoa): tipo_pessoa é só o cadastro
    // "de costume" da pessoa, e uma mesma pessoa pode ter uma visita comum
    // mesmo tendo sido registrada uma vez como prestador. Sem visita ativa
    // (não deveria acontecer — syncPessoa só chega aqui com `autorizado`
    // true — mas por segurança), cai no cadastro da pessoa.
    const ehPrestador = visitaAtiva
      ? visitaAtiva.is_prestador === 1
      : pessoa.tipo_pessoa === 'prestador';

    // Vaga ativa (Vagas.id_visita) — best-effort: a coluna `id_visita` é
    // parte da migração Pessoas/Visitas e pode não existir ainda no banco.
    // Uma falha aqui (ex.: "Unknown column") NÃO pode derrubar o sync
    // inteiro — degrada pra "sem vaga ativa" e segue.
    let temVagaAtiva = false;
    if (visitaAtiva) {
      try {
        const count = await this.prisma.vagas.count({
          where: { id_visita: visitaAtiva.id, ativo: 1, ...whereVagaVigente() },
        });
        temVagaAtiva = count > 0;
      } catch (err: any) {
        this.logger.warn(
          `pushPessoaToDevices pessoa ${pessoa.id}: falha ao consultar Vagas.id_visita (coluna pode não existir ainda) — tratando como sem vaga ativa: ${err?.message ?? err}`,
        );
        temVagaAtiva = false;
      }
    }

    // Autorização "geral" (fora do condomínio, dentro da janela) — mesmo
    // critério de `syncVisitante`.
    const liberadoGeral = !!visitaAtiva && visitaAtiva.liberado === 1 && dentroJanela && diaAutorizado;
    const categoria: CategoriaPessoa = ehPrestador ? 'prestador' : 'visitante';

    let faceId: string | null = pessoa.face_id ?? null;
    let allOk = true;
    let ultimoErro: string | null = null;
    for (const device of devices) {
      try {
        // Mesma whitelist de categoria de `syncVisitante`/`syncMorador`
        // (facial.service.ts:1909-1916): sem ela, todo visitante/prestador
        // era enrolado mesmo em terminais cuja regra ativa só permite
        // morador/funcionário — e um leitor único abre 24h ao reconhecer o
        // rosto, sem consultar a nuvem no momento da passagem.
        const permitidas = await this.categoriasPermitidasNoDispositivo(device);
        if (!this.categoriaAutorizada(permitidas, categoria)) {
          await this.client.removePerson(this.toConfig(device), faceId ?? externalId);
          continue;
        }

        // Mesmo filtro de `syncVisitante` (facial.service.ts:1895-1910): sem
        // ele, uma pessoa expirada mas ainda DENTRO do condomínio ficava
        // enrolada (sem validTo — ver acima) em TODO terminal, inclusive
        // entrada/auto — abrindo a porta de entrada pra quem já devia ter
        // perdido acesso. "Sem expiração" só é seguro no leitor de SAÍDA,
        // pra deixar quem está dentro sair.
        const podeEstarNoDispositivo =
          liberadoGeral || (dentroDoCondominio && device.sentido === 'saida');

        if (!podeEstarNoDispositivo) {
          await this.client.removePerson(this.toConfig(device), faceId ?? externalId);
          continue;
        }

        // Mesma regra do syncVisitante: prestador (pela VISITA, não pela
        // identidade — ver `ehPrestador` acima) e pessoa com vaga ativa têm
        // usos ilimitados (-1); os demais têm o contador do aparelho (UseTime).
        let userTimes = -1;
        if (!ehPrestador && !temVagaAtiva) {
          if (dentroDoCondominio) userTimes = 1;
          else userTimes = device.sentido === 'auto' ? 2 : 1;
        }

        if (faceId) {
          await this.client.updatePerson(this.toConfig(device), faceId, {
            nome: pessoa.nome,
            fotoBase64,
            validFrom,
            validTo,
            userTimes,
          });
        } else {
          const r = await this.client.enrollPerson(this.toConfig(device), {
            externalId,
            nome: pessoa.nome,
            fotoBase64,
            validFrom,
            validTo,
            userTimes,
          });
          faceId = r.faceId;
        }
      } catch (err: any) {
        allOk = false;
        ultimoErro = err?.message ?? String(err);
      }
    }

    const status = this.classificarSync(allOk, ultimoErro);
    if (this.preservarStatusGlobal(opts, allOk, pessoa.face_sync_status)) {
      return { ok: allOk, face_id: faceId, status, error: ultimoErro };
    }
    await this.prisma.pessoas.update({
      where: { id: pessoa.id },
      data: {
        face_id: faceId,
        face_sync_status: status,
        face_sync_error: allOk ? null : (ultimoErro ? String(ultimoErro).slice(0, 500) : null),
        face_enrolled_at: allOk ? new Date() : pessoa.face_enrolled_at,
      },
    });

    return { ok: allOk, face_id: faceId, status, error: ultimoErro };
  }

  /**
   * Sincroniza um prestador de serviço (tabela Prestadores_servico — a tela
   * "Cadastro de Funcionários" da Gestão de Acesso) com os terminais faciais.
   *
   * Categoria de whitelist = 'funcionario'. Sem janela de validade (acesso
   * permanente), mas respeita a restrição de dia da semana (dias_semana):
   * fora do dia autorizado o rosto é REMOVIDO do aparelho (nega fisicamente) e
   * o tickDiasSemanaSync reenrola na virada do dia. dias_semana VAZIO = nenhum
   * dia permitido (mesma semântica da tela: "Nenhum dia permitido").
   */
  async syncPrestadorServico(idPrestador: number, opts: { deviceIds?: number[]; cargaRestrita?: boolean } = {}) {
    if (FACIAL_DISABLED)
      return { skipped: true, reason: 'integration_disabled' };
    if (!this.prisma.isConnected) return { skipped: true, reason: 'no_db' };

    const prest = await this.prisma.prestadores_servico.findUnique({
      where: { id: idPrestador },
    });
    if (!prest)
      throw new NotFoundException(`Prestador ${idPrestador} não encontrado`);

    // Sem foto: remove rosto órfão do aparelho e zera o face_id.
    if (!prest.foto_pessoa) {
      if (prest.face_id && prest.id_condominio) {
        const removedOk = await this.unsyncPrestadorServico(
          idPrestador,
          prest.face_id,
          prest.id_condominio,
        );
        if (!removedOk) {
          await this.markPrestadorSyncStatus(idPrestador, 'pending');
          return { ok: false, removed: false, reason: 'remocao_pendente' };
        }
        await this.prisma.prestadores_servico.update({
          where: { id: idPrestador },
          data: { face_id: null, face_sync_status: null, face_sync_error: null, face_enrolled_at: null },
        });
        return { ok: true, removed: true };
      }
      return { skipped: true, reason: 'no_photo' };
    }

    // Mesma trava do visitante: o prestador não tem conta, então a autorização
    // e a maioridade são declaradas por quem cadastrou. `Prestadores_servico`
    // não guarda documento, então a declaração é localizada pelo par
    // (tipo, id) — ver `ConsentimentosTerceirosService`.
    if (
      !(await this.consentimentosTerceiros.autorizouBiometria({
        idCondominio: prest.id_condominio,
        tipoPessoa: 'prestador',
        idPessoa: prest.id,
        doc: null,
      }))
    ) {
      this.logger.log(
        `Prestador ${idPrestador} sem declaração de consentimento biométrico: enrolamento facial não realizado.`,
      );
      return { skipped: true, reason: 'sem_consentimento_biometria' };
    }

    // Restrição de dia da semana (horário de Brasília p/ bater com o aparelho).
    // Vazio = NENHUM dia permitido (semântica da tela de cadastro).
    const mapDiasSemana = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
    const agoraBRT = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
    );
    const diaSemanaAtual = mapDiasSemana[agoraBRT.getDay()];
    const diasPermitidos: string[] = (prest.dias_semana ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    const diaAutorizado =
      diasPermitidos.length > 0 && diasPermitidos.includes(diaSemanaAtual);

    // Só terminais faciais recebem cadastro de pessoa (foto + face_id).
    const devices = await this.prisma.facial_Devices.findMany({
      where: {
        id_condominio: prest.id_condominio,
        ativo: 1,
        tipo: 'facial',
        ...(opts.deviceIds?.length ? { id: { in: opts.deviceIds } } : {}),
      },
    });
    if (devices.length === 0) {
      return { skipped: true, reason: 'no_facial_devices' };
    }

    const externalId = `prestador_servico_${prest.id}`;

    // Fora do dia autorizado: remove de todos os terminais (nega fisicamente).
    if (!diaAutorizado) {
      if (prest.face_id) {
        const removedOk = await this.unsyncPrestadorServico(
          idPrestador,
          prest.face_id,
          prest.id_condominio,
          opts,
        );
        if (!removedOk) {
          // Mantém face_id + 'pending' p/ o back-fill re-tentar a remoção.
          // Nota: com o validTo diário gravado no aparelho, ele já nega
          // localmente após a virada do dia mesmo sem esta remoção.
          await this.markPrestadorSyncStatus(idPrestador, 'pending');
          return { ok: false, removed: false, reason: 'remocao_pendente' };
        }
        await this.prisma.prestadores_servico.update({
          where: { id: idPrestador },
          data: { face_id: null, face_sync_status: null, face_sync_error: null, face_enrolled_at: null },
        });
        return { ok: true, removed: true, reason: 'dia_nao_autorizado' };
      }
      return { skipped: true, reason: 'dia_nao_autorizado' };
    }

    const fotoBase64 = await this.fetchPhotoAsBase64(prest.foto_pessoa);
    if (!fotoBase64) {
      await this.markPrestadorSyncStatus(idPrestador, 'error', 'Erro ao baixar foto do servidor de armazenamento.');
      return { ok: false, reason: 'photo_unreachable' };
    }

    const categoria: CategoriaPessoa = 'funcionario';
    let faceId: string | null = prest.face_id ?? null;
    let allOk = true;
    let ultimoErro: string | null = null;
    const devicesSincronizados: number[] = [];
    for (const device of devices) {
      try {
        const permitidas = await this.categoriasPermitidasNoDispositivo(device);
        if (!this.categoriaAutorizada(permitidas, categoria)) {
          await this.client.removePerson(
            this.toConfig(device),
            faceId ?? externalId,
          );
          continue;
        }
        // Prestador SEMPRE tem restrição de dias (vazio = nenhum dia). O teto
        // de validade no fim do dia faz o aparelho negar sozinho após a
        // meia-noite, mesmo offline; o tick da virada re-estende nos dias
        // autorizados.
        const validTo = this.fimDoDiaBRT();
        if (faceId) {
          await this.client.updatePerson(this.toConfig(device), faceId, {
            nome: prest.nome,
            fotoBase64,
            validTo,
          });
        } else {
          const r = await this.client.enrollPerson(this.toConfig(device), {
            externalId,
            nome: prest.nome,
            fotoBase64,
            validTo,
          });
          faceId = r.faceId;
        }
        devicesSincronizados.push(device.id);
      } catch (err: any) {
        allOk = false;
        ultimoErro = err?.message ?? String(err);
        this.logger.warn(
          `Sync prestador ${idPrestador} device ${device.id} falhou: ${ultimoErro}`,
        );
      }
    }

    if (devicesSincronizados.length > 0) {
      const agora = new Date();
      this.prisma.facial_Devices
        .updateMany({
          where: { id: { in: devicesSincronizados } },
          data: { ultima_sincr: agora },
        })
        .catch((err) =>
          this.logger.warn(
            `Falha ao atualizar ultima_sincr (prestador ${idPrestador}): ${err?.message ?? err}`,
          ),
        );
    }

    const status = this.classificarSync(allOk, ultimoErro);
    if (this.preservarStatusGlobal(opts, allOk, prest.face_sync_status)) {
      return { ok: allOk, face_id: faceId, status, error: ultimoErro };
    }
    await this.prisma.prestadores_servico.update({
      where: { id: idPrestador },
      data: {
        face_id: faceId,
        face_sync_status: status,
        face_sync_error: allOk ? null : (ultimoErro ? String(ultimoErro).slice(0, 500) : null),
        face_enrolled_at: allOk ? new Date() : prest.face_enrolled_at,
      },
    });

    return { ok: allOk, face_id: faceId, status, error: ultimoErro };
  }

  /** Mesmo contrato do unsyncVisitante: `true` = removido de todos os terminais. */
  async unsyncPrestadorServico(
    idPrestador: number,
    faceId: string | null,
    idCondominio: number | null,
    opts: { deviceIds?: number[] } = {},
  ): Promise<boolean> {
    if (FACIAL_DISABLED || !faceId || !idCondominio) return true;
    const devices = await this.prisma.facial_Devices.findMany({
      where: {
        id_condominio: idCondominio,
        ativo: 1,
        tipo: 'facial',
        ...(opts.deviceIds?.length ? { id: { in: opts.deviceIds } } : {}),
      },
    });
    let allOk = true;
    for (const device of devices) {
      try {
        await this.client.removePerson(this.toConfig(device), faceId);
      } catch (err: any) {
        allOk = false;
        this.logger.warn(
          `Remoção prestador ${idPrestador} device ${device.id}: ${err?.message ?? err}`,
        );
      }
    }
    return allOk;
  }

  // ---------- Sincronização em massa (back-fill) ----------

  /**
   * Envia para os terminais faciais os rostos de TODAS as pessoas já
   * cadastradas (moradores + visitantes ativos com foto) do condomínio.
   *
   * É o "back-fill" que resolve o cenário real de implantação: os moradores
   * são cadastrados ANTES do facial existir (ou enquanto o agente está offline)
   * — então as fotos existentes não subiram. Esta função empurra todas elas.
   *
   * Processa em SEGUNDO PLANO e sequencialmente (não satura o agente nem
   * bloqueia a resposta HTTP). O progresso aparece em face_sync_status, que o
   * portal exibe via getSyncStatus.
   *
   * @param opts.onlyPending true = só quem ainda não está 'synced' (usado no
   *        auto-sync quando o agente conecta). false = re-sincroniza todos
   *        (botão manual "Sincronizar rostos").
   */
  async syncAllForCondominio(
    idCondominio: number,
    opts: {
      onlyPending?: boolean;
      /** Filtra QUEM sincronizar. Vazio/ausente = todas as categorias. */
      categorias?: CategoriaPessoa[];
      /** Limita a QUAIS terminais faciais mandar. Vazio/ausente = todos. */
      deviceIds?: number[];
    } = {},
  ) {
    if (FACIAL_DISABLED)
      return { skipped: true, reason: 'integration_disabled' };
    if (!this.prisma.isConnected) return { skipped: true, reason: 'no_db' };

    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: idCondominio, ativo: 1, tipo: 'facial' },
      select: { id: true },
    });
    if (devices.length === 0) {
      return { skipped: true, reason: 'no_facial_devices' };
    }

    if (await this.estado.obter(`facial:bulk:${idCondominio}`)) {
      return { alreadyRunning: true };
    }

    // Filtro "pendente": ainda não sincronizado com sucesso.
    // Filtro "pendente" para moradores (sem campo dias_semana).
    const pendenteWhereMorador = opts.onlyPending
      ? {
          OR: [
            { face_sync_status: { not: 'synced' } },
            { face_sync_status: null },
            { face_id: null },
          ],
        }
      : {};
    // Filtro "pendente" para visitantes/prestadores: inclui também quem tem
    // dias_semana configurado — a autorização muda a cada virada de dia.
    const pendenteWhereVisitante = opts.onlyPending
      ? {
          OR: [
            { face_sync_status: { not: 'synced' } },
            { face_sync_status: null },
            { face_id: null },
            { dias_semana: { not: null } },
          ],
        }
      : {};

    // Filtro por categoria. moradores table = morador|funcionario;
    // visitantes table = visitante|prestador; prestadores_servico = funcionario.
    const cats = opts.categorias?.length ? new Set(opts.categorias) : null;
    const queryMorador =
      !cats || cats.has('morador') || cats.has('funcionario');
    const queryVisitante =
      !cats || cats.has('visitante') || cats.has('prestador');
    // Prestadores de serviço (Gestão de Acesso) entram como 'funcionario'.
    const queryPrestador = !cats || cats.has('funcionario');
    const moradorTipoWhere =
      !cats || (cats.has('morador') && cats.has('funcionario'))
        ? {}
        : cats.has('funcionario')
          ? { tipo: 'funcionario' }
          : { OR: [{ tipo: { not: 'funcionario' } }, { tipo: null }] };
    // is_prestador é Int não-nulável (0/1) — NÃO filtrar por null (quebra o
    // Prisma). visitante = is_prestador != 1; prestador = is_prestador == 1.
    const visitanteTipoWhere =
      !cats || (cats.has('visitante') && cats.has('prestador'))
        ? {}
        : cats.has('prestador')
          ? { is_prestador: 1 }
          : { is_prestador: { not: 1 } };

    // Relevante para sync = tem foto (cadastrar) OU tem face_id (pode precisar
    // RECONCILIAR/remover do aparelho — ex.: foto removida deixou rosto órfão).
    // AND evita colisão de chave 'OR' com o filtro de pendentes/categoria.
    const temFotoOuFace = {
      OR: [{ foto_pessoa: { not: null } }, { face_id: { not: null } }],
    };
    // Mesmo filtro de "pendente" dos visitantes, adaptado: dias_semana vive
    // em Visitas (não em Pessoas — uma Pessoa tem N Visitas), daí o relation
    // filter. Sem esta consulta, uma Pessoa que ficou 'pending' (remoção que
    // não chegou no aparelho, ver unsyncPessoa) nunca era retentada por
    // nenhum tick — só moradores/visitantes/prestadores eram varridos aqui.
    const pendenteWherePessoa = opts.onlyPending
      ? {
          OR: [
            { face_sync_status: { not: 'synced' } },
            { face_sync_status: null },
            { face_id: null },
            { visitas: { some: { dias_semana: { not: null } } } },
          ],
        }
      : {};
    const pessoaTipoWhere =
      !cats || (cats.has('visitante') && cats.has('prestador'))
        ? {}
        : cats.has('prestador')
          ? { tipo_pessoa: 'prestador' }
          : { tipo_pessoa: { not: 'prestador' } };
    const [moradores, visitantes, prestadores, pessoas] = await Promise.all([
      queryMorador
        ? this.prisma.moradores.findMany({
            where: {
              id_condominio: idCondominio,
              AND: [temFotoOuFace, pendenteWhereMorador, moradorTipoWhere],
            },
            select: { id: true },
          })
        : Promise.resolve([] as { id: number }[]),
      queryVisitante
        ? this.prisma.visitantes.findMany({
            where: {
              id_condominio: idCondominio,
              // Inclui quem ainda não saiu OU quem tem face_id no aparelho
              // (pode precisar ser removido mesmo após a saída).
              OR: [{ data_saida: null }, { face_id: { not: null } }],
              AND: [temFotoOuFace, pendenteWhereVisitante, visitanteTipoWhere],
            },
            select: { id: true },
          })
        : Promise.resolve([] as { id: number }[]),
      queryPrestador
        ? this.prisma.prestadores_servico.findMany({
            where: {
              id_condominio: idCondominio,
              // Mesmo filtro pendente dos visitantes (inclui dias_semana, que
              // muda a autorização a cada virada de dia).
              AND: [temFotoOuFace, pendenteWhereVisitante],
            },
            select: { id: true },
          })
        : Promise.resolve([] as { id: number }[]),
      queryVisitante && pessoasMigrationEnabled(this.prisma)
        ? this.prisma.pessoas.findMany({
            where: {
              id_condominio: idCondominio,
              AND: [temFotoOuFace, pendenteWherePessoa, pessoaTipoWhere],
            },
            select: { id: true },
          })
        : Promise.resolve([] as { id: number }[]),
    ]);

    const total = moradores.length + visitantes.length + prestadores.length + pessoas.length;
    // Carga restrita a terminais (terminal novo/reativado/reendereçado).
    const cargaRestrita = !!opts.deviceIds?.length;
    if (total === 0) {
      // Ninguém para carregar: o terminal não tem carga a esperar.
      if (cargaRestrita) await this.concluirCargaDosTerminais(opts.deviceIds as number[], false);
      return { total: 0, started: false };
    }

    if (!(await this.estado.criarSeAusente(`facial:bulk:${idCondominio}`, true, BULK_SYNC_TTL_MS))) {
      return { alreadyRunning: true };
    }
    // Não await: roda em background. O event loop continua após o return.
    void (async () => {
      let ok = 0;
      // Important 4 (Lote B): com a flag ligada, `syncVisitante` resolve o
      // `Visitantes.id` contra `Visitas` (que não é migrado por este tick —
      // fora de escopo aqui) e devolve `{ skipped: true }` em vez de
      // sincronizar. Antes isso era contado como `ok++` igual um sucesso
      // real — o log dizia "N ok" quando na prática N não foram tocados.
      // `skipped` agora conta à parte, e o log/retorno distingue os dois.
      let skipped = 0;
      let falhou = 0;
      // Falha TRANSITÓRIA (agente/terminal fora): a carga do terminal não
      // terminou. Foto recusada ('error') é problema da pessoa, não do terminal.
      let transitorias = 0;
      const contar = (r: any) => {
        if (r?.skipped) skipped++;
        else ok++;
        if (r?.ok === false && r?.status === 'pending') transitorias++;
      };
      try {
        const deviceIds = opts.deviceIds;
        // Na carga restrita, falha não rebaixa quem já está 'synced' (6c).
        const optsPessoa = cargaRestrita ? { deviceIds, cargaRestrita: true } : { deviceIds };
        for (const m of moradores) {
          try {
            contar(await this.syncMorador(m.id, optsPessoa));
          } catch (e: any) {
            falhou++;
            this.logger.warn(`Bulk sync morador ${m.id}: ${e?.message ?? e}`);
          }
        }
        for (const v of visitantes) {
          try {
            contar(await this.syncVisitante(v.id, optsPessoa));
          } catch (e: any) {
            falhou++;
            this.logger.warn(`Bulk sync visitante ${v.id}: ${e?.message ?? e}`);
          }
        }
        for (const p of prestadores) {
          try {
            contar(await this.syncPrestadorServico(p.id, optsPessoa));
          } catch (e: any) {
            falhou++;
            this.logger.warn(`Bulk sync prestador ${p.id}: ${e?.message ?? e}`);
          }
        }
        for (const pes of pessoas) {
          try {
            contar(await this.syncPessoa(pes.id, optsPessoa));
          } catch (e: any) {
            falhou++;
            this.logger.warn(`Bulk sync pessoa ${pes.id}: ${e?.message ?? e}`);
          }
        }
        this.logger.log(
          `Bulk sync condomínio ${idCondominio}: ${ok} sincronizado(s), ${skipped} ignorado(s) (skip), ${falhou} falha(s) de ${total}`,
        );
        if (cargaRestrita) {
          await this.concluirCargaDosTerminais(
            deviceIds as number[],
            transitorias > 0 || falhou > 0,
          );
        }
      } finally {
        await this.estado.remover(`facial:bulk:${idCondominio}`).catch(() => undefined);
      }
    })();

    return { total, started: true };
  }

  /**
   * Fecha uma carga restrita a terminais. Com falha transitória o terminal
   * VOLTA a "carga pendente" (`ultima_sincr = null`) — a reconexão do agente ou
   * o `tickSyncRetry` refazem a carga só dele. Sem falha, sai de pendente (só
   * quem ainda está nulo: o sync por pessoa já grava a data a cada sucesso).
   * Nunca derruba a sincronização: erro vai para o log.
   */
  private async concluirCargaDosTerminais(deviceIds: number[], incompleta: boolean) {
    try {
      if (incompleta) {
        await this.prisma.facial_Devices.updateMany({
          where: { id: { in: deviceIds } },
          data: { ultima_sincr: null },
        });
        this.logger.warn(
          `Carga de rostos do(s) terminal(is) ${deviceIds.join(', ')} ficou INCOMPLETA (falha transitória): segue pendente e será refeita.`,
        );
      } else {
        await this.prisma.facial_Devices.updateMany({
          where: { id: { in: deviceIds }, ultima_sincr: null },
          data: { ultima_sincr: new Date() },
        });
      }
    } catch (e: any) {
      this.logger.warn(
        `Falha ao gravar o estado da carga do(s) terminal(is) ${deviceIds.join(', ')}: ${e?.message ?? e}`,
      );
    }
  }

  async unsyncAllForCondominio(
    idCondominio: number,
    opts: {
      categorias?: CategoriaPessoa[];
      deviceIds?: number[];
      keepFaceId?: boolean;
    } = {},
  ) {
    if (FACIAL_DISABLED)
      return { skipped: true, reason: 'integration_disabled' };
    if (!this.prisma.isConnected) return { skipped: true, reason: 'no_db' };

    const devices = await this.prisma.facial_Devices.findMany({
      where: {
        id_condominio: idCondominio,
        ativo: 1,
        tipo: 'facial',
        ...(opts.deviceIds?.length ? { id: { in: opts.deviceIds } } : {}),
      },
      select: { id: true },
    });
    if (devices.length === 0) {
      return { skipped: true, reason: 'no_facial_devices' };
    }

    if (await this.estado.obter(`facial:bulk:${idCondominio}`)) {
      return { alreadyRunning: true };
    }

    const cats = opts.categorias?.length ? new Set(opts.categorias) : null;
    const queryMorador =
      !cats || cats.has('morador') || cats.has('funcionario');
    const queryVisitante =
      !cats || cats.has('visitante') || cats.has('prestador');
    const queryPrestador = !cats || cats.has('funcionario');

    const moradorTipoWhere =
      !cats || (cats.has('morador') && cats.has('funcionario'))
        ? {}
        : cats.has('funcionario')
          ? { tipo: 'funcionario' }
          : { OR: [{ tipo: { not: 'funcionario' } }, { tipo: null }] };
    const visitanteTipoWhere =
      !cats || (cats.has('visitante') && cats.has('prestador'))
        ? {}
        : cats.has('prestador')
          ? { is_prestador: 1 }
          : { is_prestador: { not: 1 } };
    // Mesma regra de syncAllForCondominio: com a flag ligada, visitantes e
    // prestadores vivem em `Pessoas` (face_id `pessoa_<id>`); sem varrer essa
    // fonte, o rosto continua no aparelho abrindo a porta depois da limpeza.
    const pessoaTipoWhere =
      !cats || (cats.has('visitante') && cats.has('prestador'))
        ? {}
        : cats.has('prestador')
          ? { tipo_pessoa: 'prestador' }
          : { tipo_pessoa: { not: 'prestador' } };

    const [moradores, visitantes, prestadores, pessoas] = await Promise.all([
      queryMorador
        ? this.prisma.moradores.findMany({
            where: {
              id_condominio: idCondominio,
              face_id: { not: null },
              AND: [moradorTipoWhere],
            },
            select: { id: true, face_id: true },
          })
        : Promise.resolve([] as { id: number; face_id: string | null }[]),
      queryVisitante
        ? this.prisma.visitantes.findMany({
            where: {
              id_condominio: idCondominio,
              face_id: { not: null },
              AND: [visitanteTipoWhere],
            },
            select: { id: true, face_id: true },
          })
        : Promise.resolve([] as { id: number; face_id: string | null }[]),
      queryPrestador
        ? this.prisma.prestadores_servico.findMany({
            where: { id_condominio: idCondominio, face_id: { not: null } },
            select: { id: true, face_id: true },
          })
        : Promise.resolve([] as { id: number; face_id: string | null }[]),
      queryVisitante && pessoasMigrationEnabled(this.prisma)
        ? this.prisma.pessoas.findMany({
            where: {
              id_condominio: idCondominio,
              face_id: { not: null },
              AND: [pessoaTipoWhere],
            },
            select: { id: true, face_id: true },
          })
        : Promise.resolve([] as { id: number; face_id: string | null }[]),
    ]);

    const total =
      moradores.length + visitantes.length + prestadores.length + pessoas.length;
    if (total === 0) return { total: 0, started: false };

    if (!(await this.estado.criarSeAusente(`facial:bulk:${idCondominio}`, true, BULK_SYNC_TTL_MS))) {
      return { alreadyRunning: true };
    }
    void (async () => {
      let ok = 0;
      let falhou = 0;
      try {
        const deviceIds = opts.deviceIds;
        for (const m of moradores) {
          try {
            await this.unsyncMorador(m.id, m.face_id, idCondominio, { deviceIds });
            if (opts.keepFaceId) {
              await this.prisma.moradores.update({
                where: { id: m.id },
                data: { face_sync_status: 'pending' },
              });
            } else {
              await this.prisma.moradores.update({
                where: { id: m.id },
                data: { face_id: null, face_sync_status: null, face_enrolled_at: null },
              });
            }
            ok++;
          } catch (e: any) {
            falhou++;
            this.logger.warn(`Bulk unsync morador ${m.id}: ${e?.message ?? e}`);
          }
        }
        for (const v of visitantes) {
          try {
            await this.unsyncVisitante(v.id, v.face_id, idCondominio, { deviceIds });
            if (opts.keepFaceId) {
              await this.prisma.visitantes.update({
                where: { id: v.id },
                data: { face_sync_status: 'pending' },
              });
            } else {
              await this.prisma.visitantes.update({
                where: { id: v.id },
                data: { face_id: null, face_sync_status: null, face_enrolled_at: null },
              });
            }
            ok++;
          } catch (e: any) {
            falhou++;
            this.logger.warn(`Bulk unsync visitante ${v.id}: ${e?.message ?? e}`);
          }
        }
        for (const p of prestadores) {
          try {
            await this.unsyncPrestadorServico(p.id, p.face_id, idCondominio, { deviceIds });
            if (opts.keepFaceId) {
              await this.prisma.prestadores_servico.update({
                where: { id: p.id },
                data: { face_sync_status: 'pending' },
              });
            } else {
              await this.prisma.prestadores_servico.update({
                where: { id: p.id },
                data: { face_id: null, face_sync_status: null, face_enrolled_at: null },
              });
            }
            ok++;
          } catch (e: any) {
            falhou++;
            this.logger.warn(`Bulk unsync prestador ${p.id}: ${e?.message ?? e}`);
          }
        }
        for (const pes of pessoas) {
          try {
            const removedOk = await this.unsyncPessoa(pes.id, pes.face_id, idCondominio, {
              deviceIds,
            });
            if (!removedOk) {
              // Mesma regra de syncPessoa: a remoção não chegou a todos os
              // terminais — zerar o face_id aqui faria a nuvem achar que já
              // revogou enquanto o rosto segue ativo no aparelho. Mantém o
              // face_id + 'pending' pro reconnect/varredura tentar de novo.
              await this.prisma.pessoas.update({
                where: { id: pes.id },
                data: { face_sync_status: 'pending' },
              });
              falhou++;
              continue;
            }
            if (opts.keepFaceId) {
              await this.prisma.pessoas.update({
                where: { id: pes.id },
                data: { face_sync_status: 'pending' },
              });
            } else {
              await this.prisma.pessoas.update({
                where: { id: pes.id },
                data: {
                  face_id: null,
                  face_sync_status: null,
                  face_sync_error: null,
                  face_enrolled_at: null,
                },
              });
            }
            ok++;
          } catch (e: any) {
            falhou++;
            this.logger.warn(`Bulk unsync pessoa ${pes.id}: ${e?.message ?? e}`);
          }
        }
        this.logger.log(
          `Bulk unsync condomínio ${idCondominio}: ${ok} ok, ${falhou} falha(s) de ${total}`,
        );
      } finally {
        await this.estado.remover(`facial:bulk:${idCondominio}`).catch(() => undefined);
      }
    })();

    return { total, started: true };
  }

  /**
   * Parte "Pessoas" dos ticks de autorização (só com a flag ligada): dispara
   * `syncPessoa` — que recalcula pela janela/dia das visitas e envia ou
   * remove o rosto — e loga ok/skip/falha no mesmo formato dos blocos de
   * visitantes. `{ ok: false }` (ex.: remoção pendente no aparelho) conta
   * como falha: o rosto que devia sair continua lá.
   */
  private sincronizarPessoasDoTick(tick: string, ids: number[], rotuloOk: string) {
    const unicos = [...new Set(ids)];
    if (unicos.length === 0) return;
    let ok = 0;
    let skipped = 0;
    let falhou = 0;
    const syncs = unicos.map((id) =>
      this.syncPessoa(id)
        .then((r: any) => {
          // 'inactive' = nada foi enviado ao aparelho: não é sincronizado.
          if (r?.skipped || r?.syncState === 'inactive') skipped++;
          else if (r?.ok === false) falhou++;
          else ok++;
        })
        .catch((e: any) => {
          falhou++;
          this.logger.warn(`${tick} pessoa ${id}: ${e?.message ?? e}`);
        }),
    );
    void Promise.allSettled(syncs).then(() => {
      this.logger.log(
        `${tick} pessoas: ${ok} ${rotuloOk}, ${skipped} ignorado(s) (skip), ${falhou} falha(s) de ${unicos.length}`,
      );
    });
  }

  /**
   * Disparo horário: ao virar o dia (0h BRT), re-sincroniza todos que têm
   * restrição de dias da semana — adiciona/remove rostos conforme o dia atual.
   */
  private async tickDiasSemanaSync() {
    if (!this.prisma.isConnected) return;
    const agoraBRT = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
    );
    if (agoraBRT.getHours() !== 0) return;
    try {
      const comDias = await this.prisma.visitantes.findMany({
        where: {
          dias_semana: { not: null },
          OR: [{ foto_pessoa: { not: null } }, { face_id: { not: null } }],
        },
        select: { id: true },
      });
      // Important 4 (Lote B): `syncVisitante`, com a flag ligada, resolve
      // contra `Visitas` (não `Visitantes`) e devolve `{ skipped: true }` em
      // vez de sincronizar — a modelagem nova é coberta pelo bloco de Pessoas
      // logo abaixo. Sem contar `skipped` à parte, um log de sucesso mentiria
      // sobre quantos rostos de fato foram re-sincronizados na virada do dia.
      let visOk = 0;
      let visSkipped = 0;
      let visFalhou = 0;
      const syncsVisitantes: Promise<void>[] = [];
      for (const v of comDias) {
        syncsVisitantes.push(
          this.syncVisitante(v.id)
            .then((r: any) => {
              if (r?.skipped) visSkipped++;
              else visOk++;
            })
            .catch((e: any) => {
              visFalhou++;
              this.logger.warn(`tickDiasSemana visitante ${v.id}: ${e?.message ?? e}`);
            }),
        );
      }
      if (comDias.length > 0) {
        void Promise.allSettled(syncsVisitantes).then(() => {
          this.logger.log(
            `tickDiasSemanaSync visitantes: ${visOk} sincronizado(s), ${visSkipped} ignorado(s) (skip), ${visFalhou} falha(s) de ${comDias.length}`,
          );
        });
      }

      // Modelagem nova: a restrição mora em `Visitas.dias_semana`. Reavaliar na
      // virada reestende o teto de fim-de-dia (`fimDoDiaBRT`) — sem isso a
      // pessoa fica trancada fora depois da meia-noite mesmo num dia autorizado.
      // Só visitas ainda vigentes: revogados entram (reenrolam no dia
      // permitido), mas quem só tem visitas encerradas não é reavaliado toda
      // noite para sempre. Try próprio: falha aqui não pode pular prestadores.
      if (pessoasMigrationEnabled(this.prisma)) {
        try {
          const agora = new Date();
          const pessoasComDias = await this.prisma.pessoas.findMany({
            where: {
              OR: [{ foto_pessoa: { not: null } }, { face_id: { not: null } }],
              visitas: {
                some: {
                  dias_semana: { not: null },
                  OR: [{ data_hora_termino: null }, { data_hora_termino: { gte: agora } }],
                },
              },
            },
            select: { id: true },
          });
          this.sincronizarPessoasDoTick(
            'tickDiasSemanaSync',
            pessoasComDias.map((p: any) => p.id),
            'sincronizado(s)',
          );
        } catch (e: any) {
          this.logger.warn(`tickDiasSemanaSync pessoas erro: ${e?.message ?? e}`);
        }
      }

      // Prestadores de serviço (Gestão de Acesso) também têm restrição por dia.
      // Reavalia todos com foto ou já enrolados — a autorização muda na virada.
      const prestadores = await this.prisma.prestadores_servico.findMany({
        where: {
          OR: [{ foto_pessoa: { not: null } }, { face_id: { not: null } }],
        },
        select: { id: true },
      });
      for (const p of prestadores) {
        this.syncPrestadorServico(p.id).catch((e: any) =>
          this.logger.warn(`tickDiasSemana prestador ${p.id}: ${e?.message ?? e}`),
        );
      }
    } catch (e: any) {
      this.logger.warn(`tickDiasSemanaSync erro: ${e?.message ?? e}`);
    }
  }

  /**
   * Cron de expiração automática: busca visitantes e prestadores cuja validade
   * expirou e que possuem face_id no banco ou estão liberados. Define liberado=0
   * e executa syncVisitante para removê-los fisicamente dos terminais faciais.
   */
  private async tickExpiracaoAutomatica() {
    if (!this.prisma.isConnected) return;
    try {
      const agora = new Date();
      const expirados = await this.prisma.visitantes.findMany({
        where: {
          data_hora_termino: { lt: agora },
          OR: [
            { face_id: { not: null } },
            { liberado: 1 }
          ]
        },
        select: { id: true, liberado: true },
      });
      // Important 4 (Lote B): mesma ressalva de `tickDiasSemanaSync` — com a
      // flag ligada `syncVisitante` devolve `{ skipped: true }` em vez de
      // sincronizar (Pessoas é coberta no bloco abaixo). Conta skip à parte
      // pra não afirmar "processados" como se tivessem sido de fato
      // re-sincronizados no aparelho.
      let ok = 0;
      let skipped = 0;
      let falhou = 0;
      const syncsExpirados: Promise<void>[] = [];
      for (const v of expirados) {
        if (v.liberado === 1) {
          await this.prisma.visitantes.update({
            where: { id: v.id },
            data: { liberado: 0 }
          });
        }
        syncsExpirados.push(
          this.syncVisitante(v.id)
            .then((r: any) => {
              if (r?.skipped) skipped++;
              else ok++;
            })
            .catch((e: any) => {
              falhou++;
              this.logger.warn(`tickExpiracao visitante ${v.id}: ${e?.message ?? e}`);
            }),
        );
      }
      if (expirados.length > 0) {
        void Promise.allSettled(syncsExpirados).then(() => {
          this.logger.log(
            `tickExpiracaoAutomatica: ${expirados.length} expirado(s) — ${ok} sincronizado(s), ${skipped} ignorado(s) (skip), ${falhou} falha(s)`,
          );
        });
      }

      // Modelagem nova: `syncPessoa` olha TODAS as visitas da pessoa e só
      // remove o rosto quando nenhuma autoriza (janela/dia) e ela não está
      // dentro. Diferente do caminho legado, aqui NÃO se zera
      // `Visitas.liberado`: quem ainda está dentro com a visita vencida
      // perderia o rosto também no leitor de saída.
      // Revogados mantêm face_id (só o status vira 'revoked'): sem excluí-los
      // e sem limitar a visitas que venceram há pouco, todo visitante antigo
      // receberia remoção (ou re-push) em todo aparelho a cada tick.
      if (pessoasMigrationEnabled(this.prisma)) {
        // Tick roda a cada 15 min; 2h tolera reinícios. Sobras mais antigas
        // ficam com o validTo do aparelho e o retry de pendentes do tickSyncRetry.
        const JANELA_EXPIRACAO_PESSOAS_MS = 2 * 60 * 60 * 1000;
        const pessoasExpiradas = await this.prisma.pessoas.findMany({
          where: {
            AND: [
              { face_id: { not: null } },
              { OR: [{ face_sync_status: null }, { face_sync_status: { not: 'revoked' } }] },
              {
                visitas: {
                  some: {
                    data_hora_termino: {
                      gte: new Date(agora.getTime() - JANELA_EXPIRACAO_PESSOAS_MS),
                      lt: agora,
                    },
                  },
                },
              },
            ],
          },
          select: { id: true },
        });
        this.sincronizarPessoasDoTick(
          'tickExpiracaoAutomatica',
          pessoasExpiradas.map((p: any) => p.id),
          'sincronizado(s)',
        );
      }
    } catch (e: any) {
      this.logger.warn(`tickExpiracaoAutomatica erro: ${e?.message ?? e}`);
    }
  }

  /**
   * Cron de pré-enrolamento: a cada 15 minutos, busca visitantes/prestadores
   * liberados com início programado para os próximos 30 minutos e sem face_id.
   * Envia os rostos preventivamente para os aparelhos do condomínio.
   */
  private async tickPreEnrolamento() {
    if (!this.prisma.isConnected) return;
    try {
      const agora = new Date();
      const em30min = new Date(agora.getTime() + 30 * 60 * 1000);
      const prestes = await this.prisma.visitantes.findMany({
        where: {
          liberado: 1,
          foto_pessoa: { not: null },
          face_id: null,
          data_hora_inicio: {
            gte: agora,
            lte: em30min,
          },
        },
        select: { id: true },
      });
      // Important 4 (Lote B): mesma ressalva das duas ticks acima —
      // `syncVisitante` com a flag ligada devolve `{ skipped: true }` em vez
      // de pré-enrolar de fato (Pessoas é coberta no bloco abaixo). O log
      // antigo ("N pré-enrolados") afirmava sucesso mesmo quando nada foi
      // enviado ao aparelho.
      let ok = 0;
      let skipped = 0;
      let falhou = 0;
      const syncsPrestes: Promise<void>[] = [];
      for (const v of prestes) {
        syncsPrestes.push(
          this.syncVisitante(v.id)
            .then((r: any) => {
              if (r?.skipped) skipped++;
              else ok++;
            })
            .catch((e: any) => {
              falhou++;
              this.logger.warn(`tickPreEnrolamento visitante ${v.id}: ${e?.message ?? e}`);
            }),
        );
      }
      if (prestes.length > 0) {
        void Promise.allSettled(syncsPrestes).then(() => {
          this.logger.log(
            `tickPreEnrolamento: ${ok} pré-enrolado(s), ${skipped} ignorado(s) (skip), ${falhou} falha(s) de ${prestes.length}`,
          );
        });
      }

      if (pessoasMigrationEnabled(this.prisma)) {
        const pessoasPrestes = await this.prisma.pessoas.findMany({
          where: {
            foto_pessoa: { not: null },
            // Revogado mantém face_id: sem o 'revoked', o visitante que volta
            // nunca seria pré-enrolado.
            OR: [{ face_id: null }, { face_sync_status: 'revoked' }],
            visitas: {
              some: { liberado: 1, data_hora_inicio: { gte: agora, lte: em30min } },
            },
          },
          select: { id: true },
        });
        this.sincronizarPessoasDoTick(
          'tickPreEnrolamento',
          pessoasPrestes.map((p: any) => p.id),
          'pré-enrolado(s)',
        );
      }
    } catch (e: any) {
      this.logger.warn(`tickPreEnrolamento erro: ${e?.message ?? e}`);
    }
  }

  /**
   * Resultado da última varredura POR CONDOMÍNIO fica em estado_compartilhado
   * (`facial:fantasmas:<id>`, TTL 3h): a varredura roda numa instância (lock) e
   * o portal lê em qualquer uma. Um timestamp global dizia "varrido há 16 min"
   * mesmo quando o único terminal do condomínio estava offline e nada foi de
   * fato verificado — falsa tranquilidade para o síndico.
   */

  /**
   * Varredura de fantasmas biométricos (de hora em hora): lista UserIDs no
   * terminal e compara com os face_ids das TRÊS fontes de pessoa no banco
   * (moradores, visitantes e prestadores_servico). Remove qualquer biometria
   * órfã — é a rede de segurança que garante que um rosto EXCLUÍDO pare de
   * abrir a porta mesmo quando o unsync do delete não chegou ao aparelho
   * (agente/terminal offline no instante do delete → registro some do banco e
   * o re-sync normal nunca mais o alcança). Roda de hora em hora (não só às 3h)
   * para fechar a janela de ~24h em que o fantasma continuava abrindo.
   */
  private async tickFantasmas() {
    if (!this.prisma.isConnected) return;
    const resultado = new Map<
      number,
      {
        terminaisVarridos: number;
        terminaisComFalha: { id: number; nome: string; erro: string }[];
      }
    >();

    try {
      // Toda marca capaz de LISTAR pessoas no aparelho entra na varredura —
      // não só a linha RPC2 (Intelbras/Dahua). Sem Hikvision e Control iD aqui,
      // um rosto excluído com o agente offline continuava abrindo a porta
      // nessas marcas para sempre: a varredura é a única rede de segurança.
      const devices = await this.prisma.facial_Devices.findMany({
        where: {
          ativo: 1,
          tipo: 'facial',
          fabricante: { in: [...FABRICANTES_COM_LISTAGEM] },
        },
      });

      for (const device of devices) {
        let res = resultado.get(device.id_condominio);
        if (!res) {
          res = { terminaisVarridos: 0, terminaisComFalha: [] };
          resultado.set(device.id_condominio, res);
        }
        let varrido = false;
        try {
          const config = this.toConfig(device);
          const idsNoAparelho = await this.client.listUserIds(config);
          if (idsNoAparelho.length === 0) {
            // Lista vazia: nada a remover, o aparelho respondeu — conta como varrido.
            res.terminaisVarridos++;
            continue;
          }

          const [
            visitantesNoBanco,
            moradoresNoBanco,
            prestadoresNoBanco,
            pessoasNoBanco,
          ] = await Promise.all([
            this.prisma.visitantes.findMany({
              where: {
                id_condominio: device.id_condominio,
                face_id: { in: idsNoAparelho },
              },
              select: { face_id: true },
            }),
            this.prisma.moradores.findMany({
              where: {
                id_condominio: device.id_condominio,
                face_id: { in: idsNoAparelho },
              },
              select: { face_id: true },
            }),
            // Sem esta fonte, TODO funcionário legítimo (Prestadores_servico)
            // seria tratado como fantasma e removido — e um funcionário
            // excluído nunca seria limpo por aqui.
            this.prisma.prestadores_servico.findMany({
              where: {
                id_condominio: device.id_condominio,
                face_id: { in: idsNoAparelho },
              },
              select: { face_id: true },
            }),
            // Sem esta fonte, toda Pessoa da nova modelagem Pessoas/Visitas
            // seria tratada como fantasma e apagada do terminal ao virar a flag.
            this.prisma.pessoas.findMany({
              where: {
                id_condominio: device.id_condominio,
                face_id: { in: idsNoAparelho },
              },
              select: { face_id: true },
            }),
          ]);

          const idsNoBanco = new Set([
            ...visitantesNoBanco.map((v) => v.face_id!),
            ...moradoresNoBanco.map((m) => m.face_id!),
            ...prestadoresNoBanco.map((p) => p.face_id!),
            ...(pessoasNoBanco ?? []).map((pes) => pes.face_id!),
          ]);

          const fantasmas = idsNoAparelho.filter((id) => !idsNoBanco.has(id));
          if (fantasmas.length === 0) {
            res.terminaisVarridos++;
            continue;
          }

          await this.client.removeUsers(config, fantasmas);
          varrido = true;
          res.terminaisVarridos++;
          this.logger.log(
            `tickFantasmas device ${device.id}: ${fantasmas.length} fantasma(s) removido(s) — ${fantasmas.join(', ')}`,
          );
          // Persiste o resultado — sem isso, "quantos fantasmas foram removidos
          // na última varredura" só existia nos logs do processo, invisível
          // pra qualquer painel. Mesmo padrão de reportDeviceStatuses (AuditLog).
          await this.auditoria.registrar({
            id_condominio: device.id_condominio,
            usuario_nome: 'Sistema (varredura horária)',
            acao: 'FANTASMAS_REMOVIDOS',
            modulo: 'facial-health',
            entidade_id: device.id,
            descricao: `${fantasmas.length} biometria(s) órfã(s) removida(s) do terminal "${device.nome}".`,
            detalhes: { count: fantasmas.length, deviceNome: device.nome },
          });
        } catch (e: any) {
          this.logger.warn(
            `tickFantasmas device ${device.id}: ${e?.message ?? e}`,
          );
          // Falha na auditoria depois da remoção não invalida a varredura.
          if (!varrido) {
            res.terminaisComFalha.push({
              id: device.id,
              nome: device.nome,
              erro: String(e?.message ?? e).slice(0, 200),
            });
          }
        }
      }
      const terminouEm = new Date();
      for (const [idCondominio, r] of resultado) {
        await this.estado.definir(`facial:fantasmas:${idCondominio}`, { terminouEm, ...r }, FANTASMAS_TTL_MS);
      }
      // O findMany respondeu: condomínio sem terminal listável nesta rodada
      // (terminal removido/desativado) não pode manter alerta antigo para sempre.
      for (const e of await this.estado.listarPorPrefixo('facial:fantasmas:')) {
        const idCondominio = Number(e.chave.slice('facial:fantasmas:'.length));
        if (!resultado.has(idCondominio)) {
          await this.estado.remover(e.chave);
        }
      }
    } catch (e: any) {
      this.logger.warn(`tickFantasmas erro: ${e?.message ?? e}`);
    }
  }

  /**
   * Contadores do status de sincronização facial dos moradores do condomínio —
   * para o portal mostrar o progresso do back-fill (X enviados, Y pendentes).
   */
  async getSyncStatus(idCondominio: number) {
    if (!this.prisma.isConnected) {
      return {
        synced: 0,
        pending: 0,
        error: 0,
        semFoto: 0,
        comFoto: 0,
        total: 0,
        running: false,
      };
    }
    // Conta moradores E visitantes/prestadores (ativos = sem data_saida), pois
    // todos sincronizam rosto no aparelho. Antes só contava moradores.
    const vis = { id_condominio: idCondominio, data_saida: null };
    const [
      mSynced,
      mError,
      mComFoto,
      mTotal,
      vSynced,
      vError,
      vComFoto,
      vTotal,
    ] = await Promise.all([
      this.prisma.moradores.count({
        where: { id_condominio: idCondominio, face_sync_status: 'synced' },
      }),
      this.prisma.moradores.count({
        where: { id_condominio: idCondominio, face_sync_status: 'error' },
      }),
      this.prisma.moradores.count({
        where: { id_condominio: idCondominio, foto_pessoa: { not: null } },
      }),
      this.prisma.moradores.count({ where: { id_condominio: idCondominio } }),
      this.prisma.visitantes.count({
        where: { ...vis, face_sync_status: 'synced' },
      }),
      this.prisma.visitantes.count({
        where: { ...vis, face_sync_status: 'error' },
      }),
      this.prisma.visitantes.count({
        where: { ...vis, foto_pessoa: { not: null } },
      }),
      this.prisma.visitantes.count({ where: vis }),
    ]);
    const synced = mSynced + vSynced;
    const error = mError + vError;
    const comFoto = mComFoto + vComFoto;
    const total = mTotal + vTotal;
    // Pendente = tem foto mas ainda não está 'synced' nem em 'error'.
    const pending = Math.max(comFoto - synced - error, 0);
    return {
      synced,
      pending,
      error,
      semFoto: total - comFoto,
      comFoto,
      total,
      running: !!(await this.estado.obter(`facial:bulk:${idCondominio}`)),
    };
  }

  /**
   * Lista por PESSOA o status de sincronização facial (com motivo legível), para
   * o portal mostrar QUEM está pendente/erro — não só os números. Ordena erros e
   * pendentes primeiro. Inclui quem tem foto OU face_id (pega órfãos também).
   */
  async listSyncPessoas(idCondominio: number) {
    if (!this.prisma.isConnected) return [];
    const where = {
      OR: [{ foto_pessoa: { not: null } }, { face_id: { not: null } }],
    };
    const [moradores, visitantes] = await Promise.all([
      this.prisma.moradores.findMany({
        where: { id_condominio: idCondominio, ...where },
        select: {
          id: true,
          nome: true,
          tipo: true,
          foto_pessoa: true,
          face_sync_status: true,
          face_sync_error: true,
        },
      }),
      this.prisma.visitantes.findMany({
        where: { id_condominio: idCondominio, data_saida: null, ...where },
        select: {
          id: true,
          nome: true,
          is_prestador: true,
          foto_pessoa: true,
          face_sync_status: true,
          face_sync_error: true,
        },
      }),
    ]);

    const lista = [
      ...moradores.map((m) => ({
        tipo: 'morador' as const,
        categoria:
          m.tipo?.toLowerCase() === 'funcionario' ? 'funcionario' : 'morador',
        id: m.id,
        nome: m.nome,
        tem_foto: !!m.foto_pessoa,
        status: this.statusPessoa(m.face_sync_status, !!m.foto_pessoa),
        motivo: this.motivoSync(m.face_sync_status, !!m.foto_pessoa),
        motivo_detalhado: m.face_sync_error,
      })),
      ...visitantes.map((v) => ({
        tipo: 'visitante' as const,
        categoria: v.is_prestador === 1 ? 'prestador' : 'visitante',
        id: v.id,
        nome: v.nome,
        tem_foto: !!v.foto_pessoa,
        status: this.statusPessoa(v.face_sync_status, !!v.foto_pessoa),
        motivo: this.motivoSync(v.face_sync_status, !!v.foto_pessoa),
        motivo_detalhado: v.face_sync_error,
      })),
    ];

    const ordem: Record<string, number> = {
      error: 0,
      pending: 1,
      no_photo: 2,
      synced: 3,
    };
    lista.sort((a, b) => (ordem[a.status] ?? 9) - (ordem[b.status] ?? 9));
    return lista;
  }

  private statusPessoa(
    faceSyncStatus: string | null,
    temFoto: boolean,
  ): 'synced' | 'error' | 'pending' | 'no_photo' {
    if (faceSyncStatus === 'synced') return 'synced';
    if (faceSyncStatus === 'error') return 'error';
    if (!temFoto) return 'no_photo';
    return 'pending';
  }

  private motivoSync(faceSyncStatus: string | null, temFoto: boolean): string {
    const s = this.statusPessoa(faceSyncStatus, temFoto);
    if (s === 'synced') return 'Enviado ao aparelho.';
    if (s === 'error')
      return 'Foto recusada pelo aparelho (rosto não detectado). Troque a foto.';
    if (s === 'no_photo') return 'Sem foto cadastrada.';
    return 'Aguardando envio (terminal ou agente).';
  }

  // ---------- Webhook ----------

  async processWebhook(token: string, payload: WebhookEventDto) {
    const device = await this.prisma.facial_Devices.findFirst({
      // Condomínio desligado no CRM não registra mais eventos (pentest P-11).
      where: { webhook_token: token, ativo: 1, condominio: { ativo: 1 } },
    });
    if (!device) throw new UnauthorizedException('Token de webhook inválido');
    return this.runWebhook(device, payload);
  }

  /**
   * Ingestão de evento de acesso vinda do Agente Local (modo condomínio).
   *
   * Aparelhos Dahua/Intelbras não fazem push HTTP para uma URL arbitrária: o
   * Agente Local assina o stream de eventos do aparelho (eventManager.cgi) e
   * repassa cada acesso por aqui. Autentica pelo token do condomínio (o mesmo
   * usado no poll) e confina o evento ao device daquele tenant. Reusa toda a
   * resolução de pessoa/regra do webhook.
   */
  async processAgentEvent(
    agentToken: string,
    deviceId: number,
    payload: WebhookEventDto,
  ) {
    if (!Number.isInteger(deviceId)) {
      throw new BadRequestException('deviceId inválido');
    }
    const agente = await this.resolveAgente(agentToken);
    // Token de dispositivo (agente antigo) só fala pelo próprio dispositivo.
    if (agente.viaTokenDispositivo && deviceId !== agente.idDispositivo) {
      throw new UnauthorizedException('Dispositivo inválido para este agente');
    }
    const idCondominio = agente.idCondominio;
    const device = await this.prisma.facial_Devices.findFirst({
      where: { id: deviceId, ativo: 1 },
    });
    if (!device || device.id_condominio !== idCondominio) {
      throw new UnauthorizedException('Dispositivo inválido para este agente');
    }
    // Só terminal facial e câmera LPR geram eventos por este canal; rejeita o
    // resto para não virar vetor de injeção de acessos em leitores de outro
    // tipo. LPR entra aqui porque as câmeras Intelbras/Dahua/Hikvision não
    // fazem push para URL arbitrária — quem lê o log delas é o Agente Local.
    if (device.tipo !== 'facial' && device.tipo !== 'lpr') {
      throw new BadRequestException(
        'Endpoint de evento é só para terminal facial ou câmera LPR',
      );
    }
    // Evento sem credencial reconhecida não vira acesso — descarta cedo (evita
    // poluir o histórico com "desconhecido" via chamadas forjadas/vazias).
    const credencial =
      payload.external_id ?? payload.person_id ?? payload.placa;
    if (!credencial) {
      throw new BadRequestException('Evento sem identificador de pessoa');
    }
    return this.runWebhook(device, payload);
  }

  /**
   * Descobre de quem é a placa lida pela câmera LPR.
   *
   * Duas fontes, nesta ordem:
   *  1. Veiculos  — carro do morador, cadastro permanente.
   *  2. Vagas     — liberação temporária (visitante/inquilino), que só vale
   *                 dentro da janela inicio/fim. Fora dela a placa não abre.
   *
   * A vaga sempre tem titular (coluna obrigatória), então há a quem atribuir o
   * acesso mesmo quando ela não aponta visitante nem beneficiário — sem isso o
   * acesso cairia em "não identificado" e seria negado.
   */
  private async resolverPlaca(
    placaNormalizada: string,
    idCondominio: number,
    quando: Date,
  ): Promise<{
    tipoPessoa: 'morador' | 'visitante' | 'prestador' | 'funcionario';
    idPessoa: number;
    nomePessoa: string;
  } | null> {
    const variantes = variantesPlaca(placaNormalizada);
    if (variantes.length === 0) return null;

    const veiculos = await this.prisma.veiculos.findMany({
      where: {
        id_condominio: idCondominio,
        ativo: 1,
        placa: { in: variantes },
      },
      include: { morador: true },
      take: 5,
    });
    // A mesma placa escrita de dois jeitos ("ABC1D23" e "ABC-1D23") pode estar
    // em veículos de moradores diferentes: não dá para dizer quem chegou, então
    // não abre para "o primeiro que o banco devolver".
    const donos = new Set(
      veiculos.filter((v) => v.morador).map((v) => v.morador!.id),
    );
    if (donos.size > 1) {
      this.logger.warn(
        `LPR: placa ${placaNormalizada} casa com veículos de ${donos.size} moradores no condomínio ${idCondominio} — acesso negado por ambiguidade`,
      );
      return null;
    }
    const veiculo = veiculos.find((v) => v.morador);
    if (veiculo?.morador) {
      const m = veiculo.morador;
      return {
        tipoPessoa:
          m.tipo?.toLowerCase() === 'funcionario' ? 'funcionario' : 'morador',
        idPessoa: m.id,
        nomePessoa: m.nome,
      };
    }

    const vaga = await this.prisma.vagas.findFirst({
      where: {
        id_condominio: idCondominio,
        ativo: 1,
        placa: { in: variantes },
        AND: [
          { OR: [{ inicio: null }, { inicio: { lte: quando } }] },
          { OR: [{ fim: null }, { fim: { gte: quando } }] },
        ],
      },
      include: {
        visitante: true,
        visita: { include: { pessoa: true } },
        beneficiario: true,
        titular: true,
      },
    });
    if (!vaga) return null;

    if (vaga.visita?.pessoa) {
      return {
        tipoPessoa: vaga.visita.is_prestador === 1 ? 'prestador' : 'visitante',
        idPessoa: vaga.visita.pessoa.id,
        nomePessoa: vaga.visita.pessoa.nome,
      };
    }
    if (vaga.visitante) {
      return {
        tipoPessoa: vaga.visitante.is_prestador === 1 ? 'prestador' : 'visitante',
        idPessoa: vaga.visitante.id,
        nomePessoa: vaga.visitante.nome,
      };
    }
    const morador = vaga.beneficiario ?? vaga.titular;
    if (!morador) return null;
    return {
      tipoPessoa:
        morador.tipo?.toLowerCase() === 'funcionario' ? 'funcionario' : 'morador',
      idPessoa: morador.id,
      nomePessoa: morador.nome,
    };
  }

  /**
   * Descobre de quem é a tag lida (RFID/UHF). Fontes, nesta ordem:
   *  1. Moradores.tag_rfid — tag pessoal;
   *  2. Tags               — tag do veículo: precisa estar ATIVA e ligada a um
   *                          veículo ativo; vale para o morador dono do carro;
   *  3. Visitantes/Visitas — tag entregue ao visitante/prestador.
   *
   * O código é comparado por variantes (`gruposCodigoTag`), porque o leitor e o
   * cadastro escrevem o mesmo cartão de jeitos diferentes. A igualdade exata
   * tem prioridade; as formas convertidas (decimal x hex x Wiegand 26) só
   * valem se a exata não achar ninguém — e, se casarem com mais de um
   * cadastro diferente, o acesso é negado por ambiguidade.
   *
   * Código exato que existe mas não vale (Tag bloqueada ou sem veículo ativo)
   * é NEGADO ali (`negada`, com o motivo): seguir para as formas convertidas
   * abria o portão como o dono de OUTRA tag ("1234" bloqueada → hex 0x1234 =
   * "4660" de outro morador). Código exato em pessoas diferentes (tag pessoal
   * de um e tag do carro de outro, ou dois moradores) também é ambiguidade.
   */
  private async resolverTag(
    tagLida: string,
    idCondominio: number,
    evento: string,
  ): Promise<
    | { ambigua: true }
    | { negada: string }
    | {
        tipoPessoa: 'morador' | 'visitante' | 'prestador' | 'funcionario';
        idPessoa: number;
        nomePessoa: string;
        visita: any | null;
        whereVisita: CredencialVisitaWhere | null;
      }
    | null
  > {
    const { exatas, convertidas } = gruposCodigoTag(tagLida);
    if (exatas.length === 0) return null;

    const comoMorador = (m: { id: number; nome: string; tipo?: string | null }) => ({
      tipoPessoa:
        m.tipo?.toLowerCase() === 'funcionario'
          ? ('funcionario' as const)
          : ('morador' as const),
      idPessoa: m.id,
      nomePessoa: m.nome,
      visita: null,
      whereVisita: null,
    });
    const donosDeVeiculo = async (codigos: string[]) => {
      const tags = await this.prisma.tags.findMany({
        where: {
          id_condominio: idCondominio,
          ativo: 1,
          codigo: { in: codigos },
          veiculos: { some: { ativo: 1, id_condominio: idCondominio } },
        },
        include: {
          veiculos: {
            where: { ativo: 1, id_condominio: idCondominio },
            include: { morador: true },
          },
        },
      });
      const donos = new Map<number, { id: number; nome: string; tipo?: string | null }>();
      for (const tag of tags) {
        for (const veiculo of tag.veiculos) {
          // Defesa em profundidade: Veiculos.id_tag/id_morador referenciam só
          // por id — o dono tem de ser deste condomínio.
          if (veiculo.morador && veiculo.morador.id_condominio === idCondominio) {
            donos.set(veiculo.morador.id, veiculo.morador);
          }
        }
      }
      return [...donos.values()];
    };
    const comoVisitante = async (codigos: string[], soNaoEncerrada = false) => {
      const whereVisita: CredencialVisitaWhere = {
        tag_rfid: { in: codigos },
        id_condominio: idCondominio,
        ...(soNaoEncerrada ? { OR: VISITA_NAO_ENCERRADA } : {}),
      };
      const r = await this.resolverVisitantePorCredencial(whereVisita, evento);
      if (!r) return null;
      return {
        tipoPessoa: r.isPrestador ? ('prestador' as const) : ('visitante' as const),
        idPessoa: r.idPessoa,
        nomePessoa: r.nome,
        visita: r.visita,
        whereVisita,
      };
    };

    // --- 1ª passada: igualdade exata (normalizado ou o texto como chegou).
    // Tag pessoal e tag de veículo são conferidas JUNTAS: o mesmo código em
    // pessoas diferentes (dois moradores; tag pessoal de um e tag do carro de
    // outro) não diz quem passou — nega, em vez de "vence o primeiro".
    const moradoresExatos = await this.prisma.moradores.findMany({
      where: { tag_rfid: { in: exatas }, id_condominio: idCondominio },
    });
    const donos = await donosDeVeiculo(exatas);
    const pessoasExatas = new Map<number, { id: number; nome: string; tipo?: string | null }>();
    for (const m of moradoresExatos) pessoasExatas.set(m.id, m);
    for (const d of donos) if (!pessoasExatas.has(d.id)) pessoasExatas.set(d.id, d);
    if (pessoasExatas.size > 1) return { ambigua: true };
    if (pessoasExatas.size === 1) return comoMorador([...pessoasExatas.values()][0]);

    const visitante = await comoVisitante(exatas);
    if (visitante) return visitante;

    // O código EXATO existe em Tags mas não identificou ninguém acima: está
    // bloqueada ou sem veículo ativo. Nega aqui — a 2ª passada casaria as
    // formas convertidas com o cadastro de outra pessoa.
    const tagsExatas = await this.prisma.tags.findMany({
      where: { id_condominio: idCondominio, codigo: { in: exatas } },
      select: { ativo: true },
    });
    if (tagsExatas.length > 0) {
      return {
        negada: tagsExatas.some((t) => t.ativo !== 1)
          ? 'Tag bloqueada'
          : 'Tag sem veículo ativo',
      };
    }

    // --- 2ª passada: formas convertidas, só se forem inequívocas.
    if (convertidas.length === 0) return null;

    const moradoresConv = await this.prisma.moradores.findMany({
      where: { tag_rfid: { in: convertidas }, id_condominio: idCondominio },
    });
    const donosConv = await donosDeVeiculo(convertidas);
    // Visitante: a mesma tag fica gravada em várias visitas (e é reaproveitada
    // entre pessoas), então a identidade aqui é o CÓDIGO gravado, não a linha.
    // Só visita NÃO encerrada conta como cadastro: a tag devolvida por quem já
    // saiu não pode identificar (nem tornar ambígua) uma leitura convertida.
    const whereConv = {
      tag_rfid: { in: convertidas },
      id_condominio: idCondominio,
      OR: VISITA_NAO_ENCERRADA,
    };
    const linhasVisita: Array<{ tag_rfid: string | null }> = pessoasMigrationEnabled(
      this.prisma,
    )
      ? await this.prisma.visitas.findMany({
          where: whereConv,
          select: { tag_rfid: true },
        })
      : await this.prisma.visitantes.findMany({
          where: whereConv,
          select: { tag_rfid: true },
        });

    const cadastros = new Set<string>();
    for (const m of moradoresConv) cadastros.add(`morador:${m.id}`);
    for (const d of donosConv) cadastros.add(`morador:${d.id}`);
    for (const v of linhasVisita) {
      cadastros.add(`visita:${(v.tag_rfid ?? '').trim().toUpperCase()}`);
    }
    if (cadastros.size > 1) return { ambigua: true };

    if (moradoresConv.length > 0) return comoMorador(moradoresConv[0]);
    if (donosConv.length > 0) return comoMorador(donosConv[0]);
    if (linhasVisita.length > 0) return comoVisitante(convertidas, true);
    return null;
  }

  /** Opção "QR no app" do condomínio; sem o serviço de credenciais, desligada. */
  private async qrAppHabilitado(idCondominio: number): Promise<boolean> {
    if (!this.credenciais) return false;
    return this.credenciais.qrAppHabilitado(idCondominio);
  }

  /**
   * Contenção de ruído: true se esta negação de código dinâmico deve virar
   * evento. `reuso`, `expirado` e os demais motivos sempre gravam; formato/
   * assinatura/desconhecida gravam no máximo um a cada JANELA_RUIDO_QR_MS
   * por leitor.
   */
  private gravarNegacaoQr(idDevice: number, motivo: string): boolean {
    if (!MOTIVOS_RUIDO_QR.has(motivo)) return true;
    const agora = Date.now();
    const ultimo = this.ruidoQrGravadoEm.get(idDevice);
    if (ultimo !== undefined && agora - ultimo < JANELA_RUIDO_QR_MS) return false;
    this.ruidoQrGravadoEm.set(idDevice, agora);
    if (this.ruidoQrGravadoEm.size > 1000) {
      for (const [id, t] of this.ruidoQrGravadoEm) {
        if (agora - t >= JANELA_RUIDO_QR_MS) this.ruidoQrGravadoEm.delete(id);
      }
    }
    return true;
  }

  private async runWebhook(
    device: NonNullable<
      Awaited<ReturnType<PrismaService['facial_Devices']['findFirst']>>
    >,
    payload: WebhookEventDto,
  ) {
    // Aceita o push NATIVO dos aparelhos (Control iD, ANPR da Hikvision, ITS
    // Dahua/Intelbras, AccessControllerEvent) além do nosso formato limpo.
    // Sem isto, uma câmera LPR apontada direto para a nossa URL tinha a leitura
    // descartada em silêncio — o campo `placa` nunca chegava preenchido.
    const normalizado = normalizarPayloadNativo(payload as unknown);
    if (normalizado) payload = normalizado;

    let tipoPessoa:
      | 'morador'
      | 'visitante'
      | 'prestador'
      | 'funcionario'
      | null = null;
    let idPessoa: number | null = null;
    let nomePessoa = 'Desconhecido';
    let faceIdSalvo = '';
    // Critical 1 (Lote B): quando a credencial (QR/tag) resolve para uma
    // Visita específica (flag ligada), guarda o objeto aqui para usar
    // diretamente como `v` mais adiante — sem reeleger via
    // `resolverVisitaAtivaPessoa`. Ver `resolverVisitantePorCredencial`.
    let visitaResolvidaPorCredencial: any = null;
    // Critical follow-up (Lote B): guarda o `where` e o `evento` usados na
    // resolução acima — necessários para reresolver mais abaixo, se o
    // `isAmbiguousAuto` flipar `evento` DEPOIS que a credencial já escolheu a
    // Visita pelo palpite inicial. Ver bloco após o `isAmbiguousAuto`.
    let credencialWhereParaVisita: CredencialVisitaWhere | null = null;
    // Leitura de tag cujas variantes convertidas (decimal x hex x Wiegand)
    // casam com mais de um cadastro: nega, com o motivo no registro.
    let tagAmbigua = false;
    // Código exato cadastrado mas sem valer (Tag bloqueada / sem veículo
    // ativo): nega com o motivo no registro, sem tentar conversão.
    let tagNegadaMotivo: string | null = null;
    let eventoParaResolucaoCredencial: string | null = null;
    const confianca = payload.confidence ?? null;
    // Data ilegível no payload vira a hora de chegada (mesmo critério do
    // `isoValido` dos conversores nativos) — `Invalid Date` quebrava a gravação
    // do acesso e as comparações de janela mais abaixo.
    const timestampInformado = payload.timestamp
      ? new Date(payload.timestamp)
      : null;
    const timestamp =
      timestampInformado && !Number.isNaN(timestampInformado.getTime())
        ? timestampInformado
        : new Date();
    let evento = this.resolveEvento(device.sentido, payload);

    const qrCodeLido =
      payload.qrcode ??
      (device.tipo === 'qrcode_reader' ? payload.external_id : undefined);
    // Código dinâmico (P1/P2…, QR do app ou do passe do visitante): validado
    // pela credencial, nunca gravado nem logado — só o rótulo `cred:<id>`.
    const leituraDinamica = ehCodigoDinamico(qrCodeLido);
    const tagRfidLida =
      payload.card_uid ??
      (device.tipo === 'tag_reader' ? payload.external_id : undefined);
    // Placa só é considerada em terminal LPR — assim uma leitura de placa não
    // pode ser injetada em leitor de outro tipo. Descarta leitura suja do OCR
    // antes de virar consulta ou evento negado no histórico.
    const placaCrua =
      device.tipo === 'lpr'
        ? (payload.placa ?? payload.external_id)
        : undefined;
    // Troca posicional de caractere parecido do OCR (0/O, 1/I, 8/B...): só
    // corrige quando o resultado é uma placa válida; leitura já válida não muda.
    const placaNormalizada = corrigirPlacaOcr(normalizarPlaca(placaCrua));
    const placaLida =
      placaNormalizada && placaValida(placaNormalizada) ? placaNormalizada : '';
    const externalId = payload.external_id ?? payload.person_id ?? '';

    // Câmera LPR lê o tempo todo, inclusive carro passando na rua e placa suja.
    // Leitura que não forma uma placa válida é descartada em silêncio: virar
    // "negado" encheria o histórico de ruído e dispararia alerta à toa.
    if (device.tipo === 'lpr' && !placaLida) {
      this.logger.debug(
        `LPR: leitura ignorada no device ${device.id} (placa ilegível: "${placaCrua ?? ''}")`,
      );
      return { ok: true, ignored: 'placa_invalida' };
    }

    // Aparelho também posta o que NÃO é tentativa de acesso: heartbeat, evento
    // de porta/alarme, corpo em formato desconhecido. Sem NENHUMA credencial
    // no payload não há o que negar — gravar "negado" só enchia o histórico de
    // ruído. Ignora em silêncio, como a placa ilegível acima.
    // Continua virando "negado" + 400 mais abaixo: credencial presente e
    // desconhecida, e negação explícita do aparelho (ex.: Control iD com
    // user_id 0 → `access_denied`), que é um desconhecido tentando entrar.
    const semCredencial = ![
      payload.qrcode,
      payload.card_uid,
      payload.placa,
      payload.external_id,
      payload.person_id,
    ].some((v) => v != null && String(v).trim() !== '');
    if (semCredencial && evento !== 'negado') {
      // Em `warn`, com amostragem (1 por dispositivo a cada 10 min, em
      // memória): heartbeat é ruído, mas leitor mal configurado — mandando um
      // corpo que os conversores não entendem — não pode sumir em `debug`.
      const agoraMs = Date.now();
      const ultimoAviso = this.avisoSemCredencialEm.get(device.id);
      if (ultimoAviso === undefined || agoraMs - ultimoAviso >= AVISO_SEM_CREDENCIAL_MS) {
        this.avisoSemCredencialEm.set(device.id, agoraMs);
        this.logger.warn(
          `Webhook ignorado no device ${device.id} ("${device.nome}", ${device.tipo}): payload sem credencial reconhecida. Se este aparelho deveria estar enviando leituras, confira o formato/URL do push. (aviso limitado a 1 a cada 10 min por dispositivo)`,
        );
      } else {
        this.logger.debug(
          `Webhook ignorado no device ${device.id}: payload sem credencial reconhecida`,
        );
      }
      return { ok: true, ignored: 'payload_nao_reconhecido' };
    }

    // Evento reenviado pelo store-and-forward do agente: aconteceu no passado,
    // enquanto a nuvem estava inalcançável. Auditoria e estado entram normais
    // (com o timestamp original), mas sem debounce (o lote chega em rajada)
    // e sem acionamento automático de abertura (a pessoa já passou).
    const isBacklog = payload.backlog === true;

    // Cooldown: descarta eventos duplicados do mesmo leitor para a mesma
    // credencial dentro da janela (default 15s). Protege contra leitor com
    // defeito disparando em loop e contra usuário batendo o crachá duas vezes.
    // Vale também para LPR: o carro fica parado no portão e a câmera relê a
    // mesma placa várias vezes por segundo.
    const credencial = qrCodeLido ?? tagRfidLida ?? (placaLida || externalId) ?? '';
    if (
      !isBacklog &&
      credencial &&
      this.accessState.shouldDebounce(device.id, credencial, evento)
    ) {
      this.logger.debug(
        `Webhook ignorado por cooldown: device ${device.id}, credencial ${rotuloDeCredencial(credencial)}`,
      );
      return { ok: true, debounced: true };
    }

    if (qrCodeLido && leituraDinamica) {
      const negarDinamico = async (rotulo: string, motivo: keyof typeof TEXTO_NEGACAO): Promise<never> => {
        const texto = TEXTO_NEGACAO[motivo];
        if (this.gravarNegacaoQr(device.id, motivo)) {
          await this.registrarEvento(device, {
            face_id: rotulo,
            tipo_pessoa: 'desconhecido',
            id_pessoa: null,
            nome_pessoa: texto,
            evento: 'negado',
            confianca,
            timestamp,
          });
        }
        throw new BadRequestException(`Acesso negado: ${texto}`);
      };
      const resultado = this.credenciais
        ? await this.credenciais.validarLeitura(qrCodeLido, device, isBacklog ? timestamp : new Date())
        : ({ ok: false, rotulo: rotuloDeCredencial(qrCodeLido), motivo: 'desconhecida' } as const);
      if (!resultado.ok) {
        await negarDinamico(resultado.rotulo, resultado.motivo);
      } else if (resultado.alvo.tipo === 'morador') {
        const morador = resultado.alvo.morador;
        tipoPessoa = morador.tipo?.toLowerCase() === 'funcionario' ? 'funcionario' : 'morador';
        idPessoa = morador.id;
        nomePessoa = morador.nome;
        faceIdSalvo = resultado.rotulo;
      } else {
        // Visita: segue pelo caminho do PIN, de modo que janela, dias,
        // bloqueio e baixa continuam sendo os de hoje — mas presa à visita
        // da credencial (`id`). O PIN não é único entre visitas encerradas
        // por facial/tag/manual: só por ele, a leitura podia abrir (e dar
        // baixa) na visita de outra pessoa. O mesmo `where` vale para a
        // reresolução pelo evento final mais abaixo.
        const whereCredencialQr = {
          id: resultado.alvo.idVisita,
          codigo_acesso: resultado.alvo.codigoAcesso,
          id_condominio: device.id_condominio,
        };
        const resolvido = await this.resolverVisitantePorCredencial(whereCredencialQr, evento);
        if (resolvido) {
          tipoPessoa = resolvido.isPrestador ? 'prestador' : 'visitante';
          idPessoa = resolvido.idPessoa;
          nomePessoa = resolvido.nome;
          faceIdSalvo = resultado.rotulo;
          visitaResolvidaPorCredencial = resolvido.visita;
          if (resolvido.visita) {
            credencialWhereParaVisita = whereCredencialQr;
            eventoParaResolucaoCredencial = evento;
          }
        } else {
          // PIN anulado entre a validação e a resolução: visita encerrada.
          await negarDinamico(resultado.rotulo, 'visita_encerrada');
        }
      }
    } else if (qrCodeLido) {
      const morador = await this.prisma.moradores.findFirst({
        where: {
          qrcode_acesso: qrCodeLido,
          id_condominio: device.id_condominio,
        },
      });
      if (morador) {
        tipoPessoa =
          morador.tipo?.toLowerCase() === 'funcionario'
            ? 'funcionario'
            : 'morador';
        idPessoa = morador.id;
        nomePessoa = morador.nome;
        faceIdSalvo = qrCodeLido;
      } else if (!(await this.qrAppHabilitado(device.id_condominio))) {
        // Com "QR no app" ligado, o PIN da visita lido como QR deixa de abrir
        // (um print do QR antigo, que é o PIN, continuaria valendo); ele segue
        // valendo digitado na portaria. Cai no negado comum abaixo.
        //
        // Critical 1 (Lote B): dispatch pela flag — com ela ligada, o PIN
        // (codigo_acesso) mora em `Visitas`, não mais em `Visitantes`.
        const whereCredencialQr = {
          codigo_acesso: qrCodeLido,
          id_condominio: device.id_condominio,
        };
        const resolvido = await this.resolverVisitantePorCredencial(
          whereCredencialQr,
          evento,
        );
        if (resolvido) {
          tipoPessoa = resolvido.isPrestador ? 'prestador' : 'visitante';
          idPessoa = resolvido.idPessoa;
          nomePessoa = resolvido.nome;
          faceIdSalvo = qrCodeLido;
          visitaResolvidaPorCredencial = resolvido.visita;
          if (resolvido.visita) {
            credencialWhereParaVisita = whereCredencialQr;
            eventoParaResolucaoCredencial = evento;
          }
        }
      }
    } else if (tagRfidLida) {
      const resolvido = await this.resolverTag(
        tagRfidLida,
        device.id_condominio,
        evento,
      );
      if (resolvido && 'ambigua' in resolvido) {
        tagAmbigua = true;
      } else if (resolvido && 'negada' in resolvido) {
        tagNegadaMotivo = resolvido.negada;
      } else if (resolvido) {
        tipoPessoa = resolvido.tipoPessoa;
        idPessoa = resolvido.idPessoa;
        nomePessoa = resolvido.nomePessoa;
        faceIdSalvo = tagRfidLida;
        visitaResolvidaPorCredencial = resolvido.visita;
        if (resolvido.visita) {
          credencialWhereParaVisita = resolvido.whereVisita;
          eventoParaResolucaoCredencial = evento;
        }
      }
    } else if (placaLida) {
      const resolvido = await this.resolverPlaca(
        placaLida,
        device.id_condominio,
        timestamp,
      );
      if (resolvido) {
        tipoPessoa = resolvido.tipoPessoa;
        idPessoa = resolvido.idPessoa;
        nomePessoa = resolvido.nomePessoa;
        faceIdSalvo = placaLida;
      }
    } else if (externalId) {
      const parsed = this.parseExternalId(externalId);
      // findFirst + id_condominio do dispositivo em vez de findUnique só por id:
      // sem o escopo de tenant, um device do condomínio A relatando
      // "morador_42" (ou visitante_/prestador_servico_/pessoa_) identificava o
      // registro #42 de QUALQUER condomínio, e a decisão de porta seguia com
      // os dados (e a autorização) de uma pessoa de outro condomínio.
      if (parsed.tipo === 'morador') {
        const m = await this.prisma.moradores.findFirst({
          where: { id: parsed.id, id_condominio: device.id_condominio },
        });
        if (m) {
          tipoPessoa =
            m.tipo?.toLowerCase() === 'funcionario' ? 'funcionario' : 'morador';
          idPessoa = m.id;
          nomePessoa = m.nome;
          faceIdSalvo = m.face_id ?? externalId;
        }
      } else if (parsed.tipo === 'visitante') {
        const v = await this.prisma.visitantes.findFirst({
          where: { id: parsed.id, id_condominio: device.id_condominio },
        });
        if (v) {
          tipoPessoa = v.is_prestador === 1 ? 'prestador' : 'visitante';
          idPessoa = v.id;
          nomePessoa = v.nome;
          faceIdSalvo = v.face_id ?? externalId;
        }
      } else if (parsed.tipo === 'prestador_servico') {
        const p = await this.prisma.prestadores_servico.findFirst({
          where: { id: parsed.id, id_condominio: device.id_condominio },
        });
        if (p) {
          // Prestadores da Gestão de Acesso contam como 'funcionario' na whitelist.
          tipoPessoa = 'funcionario';
          idPessoa = p.id;
          nomePessoa = p.nome;
          faceIdSalvo = p.face_id ?? externalId;
        }
      } else if (parsed.tipo === 'pessoa' && pessoasMigrationEnabled(this.prisma)) {
        // Gateado pela flag de propósito: com ela desligada, o resto do
        // webhook assume que `idPessoa` de visitante/prestador é um id de
        // `Visitantes` (ver o fallback `visitantes.findUnique({id:idPessoa})`
        // mais abaixo) — resolver aqui contra `Pessoas` vazaria um id daquele
        // espaço pra um código que vai reconsultar a tabela errada.
        const pes = await this.prisma.pessoas.findFirst({
          where: { id: parsed.id, id_condominio: device.id_condominio },
        });
        if (pes) {
          tipoPessoa = pes.tipo_pessoa === 'prestador' ? 'prestador' : 'visitante';
          idPessoa = pes.id;
          nomePessoa = pes.nome;
          faceIdSalvo = pes.face_id ?? externalId;
        }
      } else {
        // Identificador fora do padrão morador_X/visitante_X (ex.: user_id
        // numérico do Control iD) — resolve pela coluna face_id, que o
        // enrollment grava com o id interno do aparelho.
        const m = await this.prisma.moradores.findFirst({
          where: { face_id: externalId, id_condominio: device.id_condominio },
        });
        if (m) {
          tipoPessoa =
            m.tipo?.toLowerCase() === 'funcionario' ? 'funcionario' : 'morador';
          idPessoa = m.id;
          nomePessoa = m.nome;
          faceIdSalvo = m.face_id ?? externalId;
        } else {
          const v = await this.prisma.visitantes.findFirst({
            where: { face_id: externalId, id_condominio: device.id_condominio },
          });
          if (v) {
            tipoPessoa = v.is_prestador === 1 ? 'prestador' : 'visitante';
            idPessoa = v.id;
            nomePessoa = v.nome;
            faceIdSalvo = v.face_id ?? externalId;
          } else {
            const p = await this.prisma.prestadores_servico.findFirst({
              where: { face_id: externalId, id_condominio: device.id_condominio },
            });
            if (p) {
              tipoPessoa = 'funcionario';
              idPessoa = p.id;
              nomePessoa = p.nome;
              faceIdSalvo = p.face_id ?? externalId;
            } else if (pessoasMigrationEnabled(this.prisma)) {
              // Mesmo motivo do ramo `pessoa_` acima: com a flag desligada,
              // não resolve contra `Pessoas`.
              const pes = await this.prisma.pessoas.findFirst({
                where: { face_id: externalId, id_condominio: device.id_condominio },
              });
              if (pes) {
                tipoPessoa = pes.tipo_pessoa === 'prestador' ? 'prestador' : 'visitante';
                idPessoa = pes.id;
                nomePessoa = pes.nome;
                faceIdSalvo = pes.face_id ?? externalId;
              }
            }
          }
        }
      }
    }

    if (!idPessoa || !tipoPessoa) {
      // Antes de negar, checa se há uma sessão de enrollment aguardando
      // capturar um UID/QR justamente para este leitor. Se sim, desvia o
      // valor para a sessão e responde "captured" sem registrar como acesso.
      const isLeitor =
        device.tipo === 'tag_reader' ||
        device.tipo === 'qrcode_reader' ||
        device.tipo === 'lpr';
      const valorLido = qrCodeLido ?? tagRfidLida ?? (placaLida || externalId);
      if (isLeitor && valorLido) {
        const captured = await this.enrollSessions.consumeForDevice(
          device.id,
          valorLido,
        );
        if (captured) {
          this.logger.log(
            `Enrollment capture: sessão ${captured.id} recebeu ${rotuloDeCredencial(valorLido)} no device ${device.id}`,
          );
          return {
            ok: true,
            captured: true,
            sessionId: captured.id,
            value: valorLido,
          };
        }
      }

      // A placa entra aqui: é o que a portaria precisa ver para decidir
      // sobre um veículo não cadastrado. Sem isso o registro saía vazio,
      // porque a placa não chega por external_id.
      await this.registrarEvento(device, {
        face_id:
          (qrCodeLido != null ? rotuloDeCredencial(qrCodeLido) : undefined) ??
          tagRfidLida ??
          (placaLida || externalId) ??
          'desconhecido',
        tipo_pessoa: 'desconhecido',
        id_pessoa: null,
        nome_pessoa: tagAmbigua
          ? 'Não identificado (tag ambígua: o código casa com mais de um cadastro)'
          : (tagNegadaMotivo ?? 'Não identificado ou expirado'),
        evento: 'negado',
        confianca,
        timestamp,
      });
      if (tagAmbigua) {
        this.logger.warn(
          `Tag ambígua no device ${device.id}: "${tagRfidLida}" casa com mais de um cadastro — acesso negado`,
        );
        throw new BadRequestException(
          'Acesso negado: tag ambígua (o código casa com mais de um cadastro)',
        );
      }
      if (tagNegadaMotivo) {
        this.logger.warn(
          `${tagNegadaMotivo} no device ${device.id}: "${tagRfidLida}" — acesso negado`,
        );
        throw new BadRequestException(`Acesso negado: ${tagNegadaMotivo}`);
      }
      throw new BadRequestException(
        'Acesso negado: Credencial não encontrada ou inválida',
      );
    }

    // Dedup de backlog: guarda mínima contra o MESMO evento reprocessado com
    // timestamp ~idêntico (reenvio duplicado da fila offline). A janela é
    // CURTA (5s) de propósito: o relógio do aparelho atrasa em relação à
    // nuvem, e uma janela larga engolia a saída real logo após a entrada
    // (visto em produção: saída deduplicada por "estar a 14s" da entrada).
    // O ECO da mesma passagem (ao vivo + replay do log) não é tratado aqui:
    // ele sempre chega com timestamp <= evento já registrado, e as guardas de
    // entrada/saída abaixo o descartam quietas (sem 'negado' falso).
    if (isBacklog && idPessoa != null && tipoPessoa) {
      const JANELA_MS = 5 * 1000;
      const dup = await this.prisma.acessos_Facial.findFirst({
        where: {
          id_condominio: device.id_condominio,
          tipo_pessoa: tipoPessoa,
          id_pessoa: idPessoa,
          timestamp: {
            gte: new Date(timestamp.getTime() - JANELA_MS),
            lte: new Date(timestamp.getTime() + JANELA_MS),
          },
        },
        select: { id: true },
      });
      if (dup) {
        return { ok: true, backlog: true, deduped: true };
      }
    }

    // Regras ativas para este terminal — buscadas aqui para serem usadas tanto
    // na resolução de direção (bloco abaixo) quanto na validação whitelist adiante.
    const regrasDispositivo = await this.prisma.regras_Acesso.findMany({
      where: {
        id_condominio: device.id_condominio,
        ativo: 1,
        dispositivos: { some: { id_dispositivo: device.id } },
      },
    });

    // Terminal único bidirecional (sentido "auto") que NÃO informa a direção —
    // caso dos faciais Intelbras/Dahua, que só dizem "reconheci o UserID". Sem
    // tratar, todo reconhecimento viraria "entrada" e o anti-passback bloquearia
    // do 2º acesso em diante. Resolvemos alternando pelo último acesso da pessoa:
    // entrada → saída → entrada... que é o comportamento real de um leitor único.
    //
    // Exceção: se a alternância produziria 'saida' mas nenhuma regra ativa do
    // terminal permite saída para esta categoria (ex.: visitante/prestador num
    // leitor compartilhado com regra "Apenas Entrada"), trata como 'entrada'.
    //
    // Só vale para terminal que fica nos DOIS sentidos (facial). Leitor de tag,
    // QR e câmera LPR ficam de um lado só: sem direção, a leitura é a que o
    // `resolveEvento` já deu (entrada) — ver TIPOS_LEITOR_SEM_DIRECAO.
    //
    // Isso vale para MORADOR/FUNCIONÁRIO. VISITANTE/PRESTADOR num leitor em
    // `auto` continuam sendo resolvidos pelo estado REAL da visita (dentro →
    // saída/baixa; fora → entrada): é a credencial apresentada no leitor que
    // dá a baixa de quem está dentro. Nunca pelo histórico de eventos.
    const leitorSemDirecao = ehLeitorSemDirecao(device.tipo);
    if (
      (!leitorSemDirecao ||
        tipoPessoa === 'visitante' ||
        tipoPessoa === 'prestador') &&
      // Negação informada pelo próprio aparelho nunca é reclassificada: sem
      // isto, um "denied" de pessoa conhecida virava entrada/saída no histórico.
      evento !== 'negado' &&
      this.isAmbiguousAuto(device.sentido, payload)
    ) {
      // Para visitante/prestador a fonte de verdade é o estado REAL da pessoa
      // (Visitantes.data_entrada/data_saida), não o histórico de Acessos_Facial.
      // data_saida pode ser setada por outro caminho (checkOut manual da
      // portaria, expiração automática) sem gerar um evento 'saida' aqui — se
      // a alternância continuasse olhando só o último evento bem-sucedido, ela
      // ficaria travada perpetuamente pedindo 'saida' para quem já saiu (e
      // sendo negada por "não possui entrada ativa"), num loop sem saída.
      let dentroAgora: boolean | null = null;
      if (tipoPessoa === 'visitante' || tipoPessoa === 'prestador') {
        if (pessoasMigrationEnabled(this.prisma) && idPessoa) {
          const visitaAtiva = await this.prisma.visitas.findFirst({
            where: {
              id_pessoa: idPessoa,
              id_condominio: device.id_condominio,
              data_entrada: { not: null },
              data_saida: null,
            },
            select: { id: true },
          });
          if (visitaAtiva) {
            dentroAgora = true;
          }
          // Critical 3 (Lote B): sem Visita ativa, NÃO cai para `Visitantes`
          // — `idPessoa` aqui é um id de `Pessoas`, e resolvê-lo contra
          // `Visitantes` colidiria com o registro de outra pessoa. Fica
          // `dentroAgora = null` (mesmo estado do "não achei nada"): a
          // alternância cai para o histórico de `Acessos_Facial` logo
          // abaixo, e a checagem de autorização ativa (mais adiante, no
          // bloco que decide `v`) é quem de fato nega o acesso.
        } else {
          const vAtual = await this.prisma.visitantes.findUnique({
            where: { id: idPessoa ?? undefined },
            select: { data_entrada: true, data_saida: true },
          });
          if (vAtual) dentroAgora = !!vAtual.data_entrada && !vAtual.data_saida;
        }
      }

      let eventoAlternado: string;
      if (dentroAgora !== null) {
        eventoAlternado = dentroAgora ? 'saida' : 'entrada';
      } else if (leitorSemDirecao) {
        // Leitor não alterna pelo histórico: sem visita com entrada ativa a
        // pessoa está FORA → entrada (a autorização é conferida mais abaixo).
        eventoAlternado = 'entrada';
      } else {
        const ultimo = await this.prisma.acessos_Facial.findFirst({
          where: {
            id_condominio: device.id_condominio,
            id_pessoa: idPessoa,
            tipo_pessoa: tipoPessoa,
            evento: { in: ['entrada', 'saida'] },
          },
          orderBy: { timestamp: 'desc' },
        });
        eventoAlternado = ultimo?.evento === 'entrada' ? 'saida' : 'entrada';
      }
      if (
        eventoAlternado === 'saida' &&
        tipoPessoa &&
        bloqueadoPorRegrasAcesso(
          regrasDispositivo as unknown as RegraAcessoLike[],
          'saida',
          tipoPessoa as CategoriaPessoa,
          timestamp.toTimeString().substring(0, 5),
        )
      ) {
        evento = 'entrada';
      } else {
        evento = eventoAlternado;
      }
    }

    // Critical follow-up (Lote B): o bloco `isAmbiguousAuto` ACIMA pode ter
    // acabado de flipar `evento` (ex.: 'entrada' → 'saida') DEPOIS que a
    // credencial (QR/tag) já havia desempatado `visitaResolvidaPorCredencial`
    // usando o palpite inicial de `evento`, ainda não finalizado. Se ficasse
    // assim, `v` mais abaixo seria a Visita escolhida para o sentido ERRADO —
    // ex.: pessoa DENTRO apresenta a credencial num terminal 'auto', o
    // palpite inicial é 'entrada', a credencial desempata para a Visita ainda
    // sem uso (não a que está com a pessoa dentro), e só depois o terminal é
    // corretamente reclassificado para 'saida' — negando por "sem entrada
    // ativa" numa Visita que nunca teve entrada. Reresolve com o evento FINAL.
    if (
      pessoasMigrationEnabled(this.prisma) &&
      visitaResolvidaPorCredencial &&
      credencialWhereParaVisita &&
      evento !== eventoParaResolucaoCredencial
    ) {
      const revisado = await this.resolverVisitantePorCredencial(
        credencialWhereParaVisita,
        evento,
      );
      if (revisado?.visita) {
        // A reresolução pode escolher uma Visita de OUTRA pessoa: a mesma
        // tag/PIN pode estar gravada em Visitas de pessoas diferentes (tag
        // nunca é limpa na saída) e findVisitaByCredencial não escopa por
        // pessoa. Sem atualizar idPessoa/nomePessoa/tipoPessoa junto, a
        // baixa (updateMany) e o syncPessoa acertam a Visita nova mas a
        // auditoria e a categoria (is_prestador) ficam presas na pessoa/
        // visita antiga — mesma classe do bug original, deslocada.
        visitaResolvidaPorCredencial = revisado.visita;
        idPessoa = revisado.idPessoa;
        nomePessoa = revisado.nome;
        tipoPessoa = revisado.isPrestador ? 'prestador' : 'visitante';
      }
    }

    // Rede de segurança anti falso positivo: se o terminal tem confiança mínima
    // configurada e o match veio abaixo dela, NEGA (a identificação não é
    // confiável o suficiente). 0 = desligado; confiança ausente não bloqueia.
    if (confiancaInsuficiente(confianca, device.confianca_minima ?? 0)) {
      await this.registrarEvento(device, {
        face_id:
          faceIdSalvo ||
          qrCodeLido ||
          tagRfidLida ||
          externalId ||
          'desconhecido',
        tipo_pessoa: tipoPessoa,
        id_pessoa: idPessoa,
        nome_pessoa: `${nomePessoa} (Bloqueado por baixa confiança)`,
        evento: 'negado',
        confianca,
        timestamp,
      });
      throw new BadRequestException(
        `Acesso negado: confiança do reconhecimento (${
          confianca != null
            ? Math.round(confianca <= 1 ? confianca * 100 : confianca) + '%'
            : 'não informada'
        }) abaixo do mínimo de ${device.confianca_minima}% deste terminal.`,
      );
    }

    // Regra: Visitantes e Prestadores só podem acessar se a entrada foi ativamente liberada/registrada via app ou web
    let visitaAtivaMigrada: any = null;
    let v: any = null;

    if (tipoPessoa === 'visitante' || tipoPessoa === 'prestador') {
      const migrado = pessoasMigrationEnabled(this.prisma) && !!idPessoa;
      if (migrado) {
        if (visitaResolvidaPorCredencial) {
          // Critical 1 (Lote B): a credencial (QR/tag) já escolheu a Visita
          // certa em `findVisitaByCredencial` — reconsultar `Pessoas` aqui e
          // reeleger via `resolverVisitaAtivaPessoa` (critério diferente,
          // `.find()` sem `orderBy`) podia devolver uma Visita DIFERENTE da
          // pessoa (ex.: uma revogada versus a ativa, ou uma antiga não usada
          // versus a que está com a pessoa DENTRO agora). Usa o objeto já
          // resolvido diretamente como `v`, sem reeleger.
          visitaAtivaMigrada = visitaResolvidaPorCredencial;
          v = {
            ...visitaResolvidaPorCredencial,
            nome: visitaResolvidaPorCredencial.pessoa?.nome ?? nomePessoa,
            bloqueado:
              visitaResolvidaPorCredencial.bloqueado === 1 ||
              visitaResolvidaPorCredencial.pessoa?.bloqueado === 1
                ? 1
                : 0,
          };
        } else {
          const pessoaComVisitas = await this.prisma.pessoas.findUnique({
            where: { id: idPessoa },
            include: { visitas: true },
          });
          if (pessoaComVisitas) {
            visitaAtivaMigrada = this.resolverVisitaAtivaPessoa(pessoaComVisitas);
            if (visitaAtivaMigrada) {
              v = {
                id: visitaAtivaMigrada.id,
                id_condominio: visitaAtivaMigrada.id_condominio,
                // Destino do push "entrou/saiu": sem ele o filtro de moradores
                // virava `id_apto: undefined` e o aviso ia para todo mundo.
                id_apartamento: visitaAtivaMigrada.id_apartamento,
                nome: pessoaComVisitas.nome,
                is_prestador: visitaAtivaMigrada.is_prestador,
                liberado: visitaAtivaMigrada.liberado,
                bloqueado: visitaAtivaMigrada.bloqueado || pessoaComVisitas.bloqueado,
                data_hora_inicio: visitaAtivaMigrada.data_hora_inicio,
                data_hora_termino: visitaAtivaMigrada.data_hora_termino,
                dias_semana: visitaAtivaMigrada.dias_semana,
                data_entrada: visitaAtivaMigrada.data_entrada,
                data_saida: visitaAtivaMigrada.data_saida,
                codigo_acesso: visitaAtivaMigrada.codigo_acesso,
                id_pessoa: pessoaComVisitas.id,
              };
            }
          }
        }
        // Critical 3 (Lote B): com a flag ligada, `idPessoa` é um id de
        // `Pessoas` — sem visita ativa (ou sem a própria Pessoa), o código
        // NUNCA cai para `prisma.visitantes.findUnique({ where: { id:
        // idPessoa } })`. Esse fallback resolveria um id de `Pessoas` contra
        // `Visitantes` (os dois autoincrement nascem do 1 e crescem em
        // paralelo) e podia decidir `liberado`/janela/`dias_semana` — abrir
        // ou não a porta — com base no cadastro de uma pessoa completamente
        // diferente. Sem autorização ativa aqui = nega, no mesmo formato das
        // outras negações deste webhook (registra o evento antes de lançar).
        if (!v) {
          await this.registrarEvento(device, {
            face_id:
              faceIdSalvo ||
              qrCodeLido ||
              tagRfidLida ||
              externalId ||
              'desconhecido',
            tipo_pessoa: tipoPessoa,
            id_pessoa: idPessoa,
            nome_pessoa: `${nomePessoa} (Sem visita/autorização ativa)`,
            evento: 'negado',
            confianca,
            timestamp,
          });
          throw new BadRequestException(
            'Acesso negado: nenhuma visita/autorização ativa encontrada para esta pessoa.',
          );
        }
      } else {
        v = await this.prisma.visitantes.findUnique({
          where: { id: idPessoa },
        });
      }
      if (!v) {
        throw new NotFoundException(
          'Cadastro de visitante/prestador não encontrado',
        );
      }

      if (evento === 'entrada') {
        // Validação de janela temporal (Vigência da visita/agendamento)
        const now = timestamp;
        const inicio = v.data_hora_inicio ? new Date(v.data_hora_inicio) : now;
        const termino = v.data_hora_termino
          ? new Date(v.data_hora_termino)
          : null;

        const GRACE_PERIOD_MS = 15 * 60 * 1000;

        // A entrada só é permitida a partir do horário de início exato (sem tolerância prévia)
        const inicioComTolerancia = inicio;

        if (now < inicioComTolerancia) {
          await this.registrarEvento(device, {
            face_id:
              faceIdSalvo ||
              qrCodeLido ||
              tagRfidLida ||
              externalId ||
              'desconhecido',
            tipo_pessoa: tipoPessoa,
            id_pessoa: idPessoa,
            nome_pessoa: `${nomePessoa} (Bloqueado por validade futura)`,
            evento: 'negado',
            confianca,
            timestamp,
          });
          throw new BadRequestException(
            'Acesso negado: O período de validade desta autorização ainda não iniciou.',
          );
        }

        if (termino) {
          const terminoComTolerancia = new Date(
            termino.getTime() + GRACE_PERIOD_MS,
          );
          if (now > terminoComTolerancia) {
            // Se expirou temporalmente, revoga a flag liberado no banco para 0
            if (visitaAtivaMigrada) {
              await this.prisma.visitas.update({
                where: { id: visitaAtivaMigrada.id },
                data: { liberado: 0 },
              });
              void this.syncPessoa(idPessoa).catch((err) =>
                this.logger.warn(
                  `Re-sync pós-expiração da pessoa ${idPessoa} falhou: ${err?.message ?? err}`,
                ),
              );
            } else {
              await this.prisma.visitantes.update({
                where: { id: v.id },
                data: { liberado: 0 },
              });
              // Rede de segurança: remove o rosto do aparelho (em background) para
              // que a PRÓXIMA tentativa seja negada FISICAMENTE, não só na nuvem.
              void this.syncVisitante(v.id).catch((err) =>
                this.logger.warn(
                  `Re-sync pós-expiração do visitante ${v.id} falhou: ${err?.message ?? err}`,
                ),
              );
            }

            await this.registrarEvento(device, {
              face_id:
                faceIdSalvo ||
                qrCodeLido ||
                tagRfidLida ||
                externalId ||
                'desconhecido',
              tipo_pessoa: tipoPessoa,
              id_pessoa: idPessoa,
              nome_pessoa: `${nomePessoa} (Bloqueado por validade expirada)`,
              evento: 'negado',
              confianca,
              timestamp,
            });
            throw new BadRequestException(
              'Acesso negado: O período de validade desta autorização já expirou.',
            );
          }
        }

        // Validação de dias da semana autorizados
        if (v.dias_semana) {
          const diasPermitidos: string[] = String(v.dias_semana)
            .split(',')
            .map((d: string) => d.trim().toLowerCase())
            .filter(Boolean);
          if (diasPermitidos.length > 0) {
            const mapDias = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
            // Usa horário de Brasília para que meia-noite local não resulte em
            // dia errado quando o servidor está em UTC (Railway default é UTC).
            const nowBRT = new Date(
              now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
            );
            const diaSemanaAtual = mapDias[nowBRT.getDay()];
            if (!diasPermitidos.includes(diaSemanaAtual)) {
              await this.registrarEvento(device, {
                face_id:
                  faceIdSalvo ||
                  qrCodeLido ||
                  tagRfidLida ||
                  externalId ||
                  'desconhecido',
                tipo_pessoa: tipoPessoa,
                id_pessoa: idPessoa,
                nome_pessoa: `${nomePessoa} (Bloqueado por dia da semana não autorizado)`,
                evento: 'negado',
                confianca,
                timestamp,
              });
              throw new BadRequestException(
                'Acesso negado: Entrada não permitida no dia de hoje.',
              );
            }
          }
        }

        if (v.liberado !== 1) {
          await this.registrarEvento(device, {
            face_id:
              faceIdSalvo ||
              qrCodeLido ||
              tagRfidLida ||
              externalId ||
              'desconhecido',
            tipo_pessoa: tipoPessoa,
            id_pessoa: idPessoa,
            nome_pessoa: `${nomePessoa} (Bloqueado por falta de liberação)`,
            evento: 'negado',
            confianca,
            timestamp,
          });
          throw new BadRequestException(
            'Acesso negado: A entrada deste visitante não foi autorizada pelo morador ou portaria.',
          );
        }
      } else if (evento === 'saida') {
        if (!v.data_entrada || v.data_saida) {
          await this.registrarEvento(device, {
            face_id:
              faceIdSalvo ||
              qrCodeLido ||
              tagRfidLida ||
              externalId ||
              'desconhecido',
            tipo_pessoa: tipoPessoa,
            id_pessoa: idPessoa,
            nome_pessoa: `${nomePessoa} (Bloqueado por não estar no condomínio)`,
            evento: 'negado',
            confianca,
            timestamp,
          });
          throw new BadRequestException(
            'Acesso negado: Este visitante não possui uma entrada ativa no condomínio para poder registrar saída.',
          );
        }
      }
    }

    // Validação de Regras de Acesso (Sprint 3 com Horários e Sentidos)
    // regrasDispositivo já foi buscado acima para resolver a direção da alternância.
    if (regrasDispositivo.length > 0) {
      // Modelo WHITELIST (engine extraída em access-rules.util.ts, testada
      // exaustivamente). Se o terminal tem regras ativas, só passa se alguma
      // cobrir simultaneamente sentido + horário + categoria; senão, NEGA.
      const horaMinutoAtual = timestamp.toTimeString().substring(0, 5); // "HH:MM"

      if (
        bloqueadoPorRegrasAcesso(
          regrasDispositivo as unknown as RegraAcessoLike[],
          evento,
          tipoPessoa as CategoriaPessoa,
          horaMinutoAtual,
        )
      ) {
        await this.registrarEvento(device, {
          face_id:
            faceIdSalvo ||
            qrCodeLido ||
            tagRfidLida ||
            externalId ||
            'desconhecido',
          tipo_pessoa: tipoPessoa,
          id_pessoa: idPessoa,
          nome_pessoa: `${nomePessoa} (Bloqueado por Regra de Acesso)`,
          evento: 'negado',
          confianca,
          timestamp,
        });

        const sentidoLabel =
          evento === 'entrada'
            ? 'entrada'
            : evento === 'saida'
              ? 'saída'
              : evento;
        const categoriaLabel =
          tipoPessoa === 'morador'
            ? 'Moradores'
            : tipoPessoa === 'prestador'
              ? 'Prestadores'
              : tipoPessoa === 'funcionario'
                ? 'Funcionários'
                : 'Visitantes';
        throw new BadRequestException(
          `Acesso negado: as regras deste terminal não permitem ${sentidoLabel} para ${categoriaLabel} neste horário.`,
        );
      }
    }

    // Controle de Anti-passback (Evita registro duplicado sequencial de entrada ou saída).
    //
    // Para VISITANTE/PRESTADOR o estado real é data_entrada/data_saida do próprio
    // registro, já validado acima (saída exige entrada ativa; entrada não duplica).
    // Basear o anti-passback no histórico de eventos aqui causava falso bloqueio:
    // um evento de saída antigo em Acessos_Facial barrava nova saída mesmo o
    // visitante estando DENTRO (data_saida=null) — agravado por registros
    // duplicados da mesma pessoa. Por isso só aplicamos este anti-passback a
    // morador/funcionário, que não têm data_entrada/data_saida persistidas.
    //
    // Também não vale para leitura de tag/QR/LPR (TIPOS_LEITOR_SEM_DIRECAO):
    // com antena só na entrada e saída livre não existe evento de saída, e a
    // segunda entrada ficaria negada para sempre. Quem quer esse bloqueio nos
    // leitores liga ANTI_PASSBACK_MODE=hard.
    const aplicarAntiPassbackEvento =
      (tipoPessoa === 'morador' || tipoPessoa === 'funcionario') &&
      (!ehLeitorSemDirecao(device.tipo) || antiPassbackHard());
    if (
      aplicarAntiPassbackEvento &&
      (evento === 'entrada' || evento === 'saida')
    ) {
      const ultimoAcesso = await this.prisma.acessos_Facial.findFirst({
        where: {
          tipo_pessoa: tipoPessoa,
          id_pessoa: idPessoa,
          evento: { in: ['entrada', 'saida'] },
        },
        orderBy: { timestamp: 'desc' },
      });

      if (ultimoAcesso && ultimoAcesso.evento === evento) {
        await this.registrarEvento(device, {
          face_id:
            faceIdSalvo ||
            qrCodeLido ||
            tagRfidLida ||
            externalId ||
            'desconhecido',
          tipo_pessoa: tipoPessoa,
          id_pessoa: idPessoa,
          nome_pessoa: `${nomePessoa} (Bloqueado por Anti-passback)`,
          evento: 'negado',
          confianca,
          timestamp,
        });

        const sentidoLabel = evento === 'entrada' ? 'entrada' : 'saída';
        throw new BadRequestException(
          `Acesso negado: O usuário já registrou uma ${sentidoLabel} e não pode registrar outra sequencialmente (Regra de Anti-passback).`,
        );
      }
    }

    // Anti-passback em memória (AccessStateService): estado dentro/fora por
    // condomínio, configurável via ANTI_PASSBACK_MODE (off/soft/hard). Estava
    // implementado mas nunca era chamado — código morto. Cobre crachá clonado
    // tentando entrar enquanto o original está dentro, cenário que o
    // anti-passback por histórico acima não pega para visitante/prestador.
    // "off" (default) só acumula estado; "soft" deixa passar mas marca o
    // registro como suspeito; "hard" nega. Estado é perdido em restart
    // (limitação documentada no serviço — mitigar com Redis se houver SLA).
    if (evento === 'entrada' || evento === 'saida') {
      // A presença vem SEMPRE do último evento persistido em Acessos_Facial
      // (o Map do AccessStateService é só o lugar onde a decisão é tomada).
      // Com 2 instâncias, o Map desta instância não vê a saída registrada
      // pela outra — confiar nele faria o modo "hard" negar a entrada de quem
      // de fato saiu. Também cobre o pós-restart (Map vazio).
      if (idPessoa != null) {
        const ultimo = await this.prisma.acessos_Facial.findFirst({
          where: {
            id_condominio: device.id_condominio,
            tipo_pessoa: tipoPessoa,
            id_pessoa: idPessoa,
            evento: { in: ['entrada', 'saida'] },
          },
          orderBy: { timestamp: 'desc' },
          select: { evento: true },
        });
        if (ultimo) {
          this.accessState.setPresenca(
            device.id_condominio,
            tipoPessoa,
            idPessoa,
            ultimo.evento === 'entrada' ? 'dentro' : 'fora',
          );
        }
      }

      const apbBruto = this.accessState.checkAntiPassback(
        device.id_condominio,
        tipoPessoa,
        idPessoa,
        evento,
      );
      // Backlog nunca é negado por APB: o evento já aconteceu fisicamente —
      // negar agora só falsificaria a auditoria. Rebaixa para "suspeito".
      const apb =
        apbBruto === 'deny' && isBacklog ? 'allow_with_warning' : apbBruto;
      if (apb === 'deny') {
        await this.registrarEvento(device, {
          face_id:
            faceIdSalvo ||
            qrCodeLido ||
            tagRfidLida ||
            externalId ||
            'desconhecido',
          tipo_pessoa: tipoPessoa,
          id_pessoa: idPessoa,
          nome_pessoa: `${nomePessoa} (Bloqueado por Anti-passback)`,
          evento: 'negado',
          confianca,
          timestamp,
        });
        const sentidoLabel = evento === 'entrada' ? 'entrada' : 'saída';
        throw new BadRequestException(
          `Acesso negado: ${sentidoLabel} repetida detectada (Anti-passback). Procure a portaria.`,
        );
      }
      // Leitor de tag/QR/LPR com antena só na entrada (saída livre): a entrada
      // repetida de morador/funcionário é o normal — no modo soft a marca
      // cairia em quase toda entrada. Só a marca é dispensada: o estado de
      // presença já foi atualizado acima e o modo hard ('deny') segue negando
      // (ou, em backlog, marcando).
      const entradaRepetidaEsperada =
        apbBruto === 'allow_with_warning' &&
        evento === 'entrada' &&
        ehLeitorSemDirecao(device.tipo) &&
        (tipoPessoa === 'morador' || tipoPessoa === 'funcionario');
      if (apb === 'allow_with_warning' && !entradaRepetidaEsperada) {
        // Modo soft: o acesso passa, mas o registro fica marcado para auditoria.
        nomePessoa = `${nomePessoa} (Suspeita de anti-passback)`;
      }
    }

    if (tipoPessoa === 'morador' || tipoPessoa === 'funcionario') {
      await this.registrarEvento(device, {
        face_id: faceIdSalvo,
        tipo_pessoa: tipoPessoa,
        id_pessoa: idPessoa,
        nome_pessoa: nomePessoa,
        evento,
        confianca,
        timestamp,
      });
    } else {
      const isEntrada = evento === 'entrada';
      if (!v) {
        v = await this.prisma.visitantes.findUnique({
          where: { id: idPessoa },
        });
      }
      if (!v)
        throw new NotFoundException(
          'Cadastro de visitante/prestador não encontrado',
        );

      // Updates ATÔMICOS com guarda no where: a validação feita acima leu o
      // visitante num findUnique separado, então dois webhooks simultâneos da
      // mesma credencial (leitor com bounce, tag clonada em dois leitores)
      // passavam ambos pela validação antes de qualquer um gravar. A condição
      // no where garante que só UM update vence; count===0 significa que outro
      // evento concorrente chegou primeiro (ou a liberação foi revogada) e
      // este deve ser negado.
      if (isEntrada) {
        let r: { count: number };
        if (visitaAtivaMigrada) {
          r = await this.prisma.visitas.updateMany({
            where: { id: visitaAtivaMigrada.id, liberado: 1 },
            data: { data_entrada: timestamp, data_saida: null },
          });
        } else {
          r = await this.prisma.visitantes.updateMany({
            where: { id: v.id, liberado: 1 },
            data: { data_entrada: timestamp, data_saida: null },
          });
        }
        if (r.count === 0) {
          // Eco da própria saída no replay do backlog (mesma passagem física
          // reportada 2x; a alternância a reclassificou como 'entrada' porque
          // a saída já estava registrada). Descarta quieto — sem 'negado' falso.
          if (
            isBacklog &&
            v.data_saida &&
            timestamp.getTime() <= new Date(v.data_saida).getTime()
          ) {
            return { ok: true, backlog: true, deduped: true };
          }
          await this.registrarEvento(device, {
            face_id: faceIdSalvo,
            tipo_pessoa: v.is_prestador === 1 ? 'prestador' : 'visitante',
            id_pessoa: v.id,
            nome_pessoa: `${nomePessoa} (Bloqueado por liberação revogada/concorrência)`,
            evento: 'negado',
            confianca,
            timestamp,
          });
          throw new BadRequestException(
            'Acesso negado: A liberação deste visitante foi revogada ou já consumida.',
          );
        }

        // Card ao vivo: o morador vê o visitante ENTROU (melhor esforço).
        if (this.cardAoVivo) {
          const origemCard = visitaAtivaMigrada ? 'visita' : 'visitante';
          const idCard = visitaAtivaMigrada ? visitaAtivaMigrada.id : v.id;
          void this.cardAoVivo
            .entrou(origemCard, idCard, timestamp)
            .catch((err) => this.logger.warn(`Card ao vivo (entrada ${idCard}): ${err?.message ?? err}`));
        }

        // A entrada consumiu uso(s) do contador local do aparelho (UseTime) —
        // e o burst de reconhecimento (vários frames por aproximação) pode ter
        // queimado mais de um. Re-sincroniza em background para regravar o
        // cadastro com exatamente 1 uso restante (a saída): é isso que garante
        // que a saída libera UMA única vez mesmo com o aparelho offline.
        if (v.is_prestador !== 1) {
          if (visitaAtivaMigrada) {
            void this.syncPessoa(idPessoa).catch((err) =>
              this.logger.warn(
                `Re-sync pós-entrada da pessoa ${idPessoa} falhou: ${err?.message ?? err}`,
              ),
            );
          } else {
            void this.syncVisitante(v.id).catch((err) =>
              this.logger.warn(
                `Re-sync pós-entrada do visitante ${v.id} falhou: ${err?.message ?? err}`,
              ),
            );
          }
        }
      } else if (evento === 'saida') {
        // Visitante com VAGA ativa (o morador reservou vaga p/ o carro) NÃO é
        // deautorizado ao sair — pode reentrar quantas vezes quiser na janela,
        // como prestador. Sem isso, a 1ª saída zera liberado e o remove do
        // aparelho, impedindo a reentrada.
        let temVagaAtiva = false;
        if (visitaAtivaMigrada) {
          temVagaAtiva =
            v.is_prestador !== 1 &&
            (await this.prisma.vagas.count({
              where: { id_visita: visitaAtivaMigrada.id, ativo: 1, ...whereVagaVigente() },
            })) > 0;
        } else {
          temVagaAtiva =
            v.is_prestador !== 1 &&
            (await this.prisma.vagas.count({
              where: { id_visitante: v.id, ativo: 1, ...whereVagaVigente() },
            })) > 0;
        }
        // Visitante recorrente (dias da semana, com término no futuro) volta
        // outro dia: a saída não revoga a liberação, como o prestador (mesma
        // regra do check-out manual). Sem término viraria acesso permanente.
        const recorrenteValendo =
          !!String(v.dias_semana ?? '').trim() &&
          !!v.data_hora_termino &&
          new Date(v.data_hora_termino).getTime() > Date.now();
        const manterLiberado = v.is_prestador === 1 || temVagaAtiva || recorrenteValendo;
        // data_entrada < timestamp: um replay de backlog com timestamp ANTERIOR
        // à entrada registrada é o eco da própria entrada (mesma passagem
        // reportada 2x: ao vivo e pelo log do aparelho) — nunca uma saída real.
        // Sem esta guarda, data_saida ficava antes de data_entrada.
        let r: { count: number };
        if (visitaAtivaMigrada) {
          r = await this.prisma.visitas.updateMany({
            where: {
              id: visitaAtivaMigrada.id,
              data_entrada: { not: null, lt: timestamp },
              data_saida: null,
            },
            data: {
              data_saida: timestamp,
              ...(device.tipo === 'qrcode_reader' ? { codigo_acesso: null } : {}),
              liberado: manterLiberado ? 1 : 0,
            },
          });
        } else {
          r = await this.prisma.visitantes.updateMany({
            where: {
              id: v.id,
              data_entrada: { not: null, lt: timestamp },
              data_saida: null,
            },
            data: {
              data_saida: timestamp,
              ...(device.tipo === 'qrcode_reader' ? { codigo_acesso: null } : {}),
              liberado: manterLiberado ? 1 : 0,
            },
          });
        }
        if (r.count === 0) {
          // Eco da própria entrada no replay do backlog: timestamp do aparelho
          // <= entrada registrada (o evento ao vivo usa hora de chegada, que é
          // sempre posterior). Mesma passagem física — descarta QUIETO, sem
          // poluir a auditoria com um 'negado' falso.
          if (
            isBacklog &&
            v.data_entrada &&
            timestamp.getTime() <= new Date(v.data_entrada).getTime()
          ) {
            return { ok: true, backlog: true, deduped: true };
          }
          await this.registrarEvento(device, {
            face_id: faceIdSalvo,
            tipo_pessoa: v.is_prestador === 1 ? 'prestador' : 'visitante',
            id_pessoa: v.id,
            nome_pessoa: `${nomePessoa} (Bloqueado por saída duplicada/concorrência)`,
            evento: 'negado',
            confianca,
            timestamp,
          });
          throw new BadRequestException(
            'Acesso negado: Este visitante não possui uma entrada ativa no condomínio para poder registrar saída.',
          );
        }

        // Saiu: a autorização do visitante (não-prestador) foi consumida
        // (liberado=0). Re-sincroniza em background para REMOVER o rosto do
        // aparelho — senão ele continuaria abrindo no próximo reconhecimento,
        // mesmo a nuvem negando. syncVisitante decide (prestador permanece).
        if (visitaAtivaMigrada) {
          void this.syncPessoa(idPessoa).catch((err) =>
            this.logger.warn(
              `Re-sync pós-saída da pessoa ${idPessoa} falhou: ${err?.message ?? err}`,
            ),
          );
        } else {
          void this.syncVisitante(v.id).catch((err) =>
            this.logger.warn(
              `Re-sync pós-saída do visitante ${v.id} falhou: ${err?.message ?? err}`,
            ),
          );
        }
      }

      await this.registrarEvento(device, {
        face_id: faceIdSalvo,
        tipo_pessoa: v.is_prestador === 1 ? 'prestador' : 'visitante',
        id_pessoa: v.id,
        nome_pessoa: nomePessoa,
        evento,
        confianca,
        timestamp,
      });

      // Backlog não notifica em tempo real — o evento é antigo; uma rajada
      // de "fulano entrou" horas depois só confunde o morador. Fica na auditoria.
      // Sem apartamento não há a quem avisar. Nunca consultar com
      // `id_apto: undefined`: o Prisma ignora o filtro e o push iria para
      // todos os usuários de todos os condomínios.
      if ((evento === 'entrada' || evento === 'saida') && !isBacklog && v.id_apartamento) {
        try {
          const moradores = await this.prisma.users.findMany({
            where: {
              apartamentosUsers: { some: { id_apto: v.id_apartamento } },
              fcm_token: { not: null },
              notif_visitantes: 1,
            },
            select: { fcm_token: true },
          });
          const label = v.is_prestador === 1 ? 'Prestador' : 'Visitante';
          const titulo =
            evento === 'entrada' ? `${label} entrou` : `${label} saiu`;
          const corpo =
            evento === 'entrada'
              ? `${v.nome} acabou de entrar no condomínio.`
              : `${v.nome} acabou de sair do condomínio.`;
          for (const u of moradores) {
            if (u.fcm_token) {
              await this.notifications.sendPushNotification(
                u.fcm_token,
                titulo,
                corpo,
                { id: v.id.toString(), type: 'visitante_acesso' },
              );
            }
          }
        } catch (err) {
          this.logger.warn(`Push de acesso falhou: ${err}`);
        }
      }
    }

    // === PONTE: leitor identificou → aciona dispositivo de abertura ===
    //
    // Leitores RFID e QR Code só LEEM credenciais — eles não abrem a porta
    // sozinhos. Quando o webhook recebe uma identificação bem-sucedida
    // desses tipos, automaticamente acionamos todas as botoeiras e catracas
    // ativas do mesmo condomínio.
    //
    // Cenário típico: condomínio tem 1 leitor RFID na entrada + 1 botoeira
    // que abre o portão. Morador encosta o crachá → leitor identifica →
    // ponte aciona botoeira → portão abre.
    //
    // Para setups com múltiplas entradas, configure Regras_Dispositivos:
    // crie uma regra ativa que inclua o leitor X E a(s) abertura(s) que ele
    // deve acionar. Só essas aberturas serão disparadas.
    //
    // Se NENHUMA regra mapeia o leitor para aberturas específicas, cai no
    // fallback: aciona todas as aberturas ativas do condomínio (comportamento
    // legado, útil pra condomínios simples com 1 entrada).
    //
    // SAÍDA só aciona quando o destino é explícito: o leitor é etapa de um
    // caminho (1º) ou está mapeado numa regra que vale para saída (2º). O
    // fallback "aciona tudo" (3º) é exclusivo de ENTRADA — um leitor de saída
    // sem mapeamento não pode abrir todos os portões do condomínio.
    //
    // A câmera LPR entra aqui pelo mesmo caminho: ela só LÊ a placa, quem abre
    // o portão é a botoeira/catraca acionada por esta ponte.
    const isLeitor =
      device.tipo === 'tag_reader' ||
      device.tipo === 'qrcode_reader' ||
      device.tipo === 'lpr';
    // Backlog NUNCA aciona abertura: o evento é antigo (a pessoa já passou
    // enquanto a nuvem estava fora) — abrir a porta agora seria um furo.
    const ehSaida = evento === 'saida';
    // Saída só aciona abertura com direção EXPLÍCITA: leitor configurado como
    // `saida` ou direção de saída informada no payload. Saída INFERIDA pelo
    // estado da visita (leitor em `auto`: "está dentro → saída") só registra a
    // baixa — ela não passa por validade/dias/liberado/bloqueio, e abrir aqui
    // deixava quem ficou "dentro" para sempre entrar com a autorização vencida.
    const saidaExplicita =
      device.sentido === 'saida' ||
      this.normalizeEvento(payload.event, payload.direction) === 'saida';
    if (
      isLeitor &&
      (evento === 'entrada' || (ehSaida && saidaExplicita)) &&
      !isBacklog
    ) {
      // 1º) Caminho de leitores: se este leitor é etapa de um caminho ativo,
      // ele aciona SOMENTE a abertura daquela etapa.
      //
      // É o que separa portão da rua e portão interno: sem isso, o fallback
      // abaixo abriria os dois de uma vez na primeira identificação, e a
      // segunda etapa perderia o sentido.
      const etapa = await this.prisma.caminhos_Etapas.findFirst({
        where: {
          id_leitor: device.id,
          caminho: { id_condominio: device.id_condominio, ativo: 1 },
        },
        include: { abertura: true, caminho: { select: { nome: true } } },
      });

      let aberturasParaAcionar: any[];

      if (etapa) {
        // Etapa sem abertura é intencional (só registra a passagem) ou está com
        // o aparelho desativado/removido. Nos dois casos NÃO cai no fallback:
        // abrir tudo aqui seria pior do que não abrir nada.
        const alvo =
          etapa.abertura && etapa.abertura.ativo === 1 ? [etapa.abertura] : [];
        aberturasParaAcionar = alvo;
        this.logger.log(
          `Caminho "${etapa.caminho?.nome}" etapa ${etapa.ordem}: leitor ${device.id} → ${
            alvo.length ? `abertura ${alvo[0].id}` : 'nenhuma abertura vinculada'
          }`,
        );
      } else {
        // 2º) Sem caminho: mantém o roteamento por regras já existente.
        // Busca aberturas vinculadas a esse leitor via regras ativas.
        // Uma regra que tenha o leitor E aberturas define o roteamento.
        const regrasDoLeitor = await this.prisma.regras_Acesso.findMany({
          where: {
            id_condominio: device.id_condominio,
            ativo: 1,
            dispositivos: { some: { id_dispositivo: device.id } },
          },
          include: {
            dispositivos: {
              include: { dispositivo: true },
            },
          },
        });

        const aberturasMapeadas = new Map<number, typeof device>();
        for (const regra of regrasDoLeitor) {
          // Regra "só entrada" não roteia a abertura de uma saída.
          if (ehSaida && regra.sentido !== 'ambos' && regra.sentido !== 'saida') {
            continue;
          }
          for (const link of regra.dispositivos) {
            const d = link.dispositivo;
            if (
              d &&
              d.id !== device.id &&
              d.id_condominio === device.id_condominio &&
              d.ativo === 1 &&
              (d.tipo === 'botoeira' || d.tipo === 'catraca')
            ) {
              aberturasMapeadas.set(d.id, d as any);
            }
          }
        }

        aberturasParaAcionar =
          aberturasMapeadas.size > 0
            ? Array.from(aberturasMapeadas.values())
            : ehSaida
              ? []
              : await this.prisma.facial_Devices.findMany({
                  where: {
                    id_condominio: device.id_condominio,
                    ativo: 1,
                    tipo: { in: ['botoeira', 'catraca'] },
                  },
                });

        if (aberturasMapeadas.size === 0 && !ehSaida) {
          this.logger.warn(
            `Ponte usando FALLBACK (sem mapeamento): leitor ${device.id} acionando todas as aberturas do condomínio`,
          );
        }
      }

      for (const abertura of aberturasParaAcionar) {
        try {
          const result = await this.client.triggerRelay(
            this.toConfig(abertura),
          );
          await this.registrarEvento(abertura, {
            face_id: faceIdSalvo || 'ponte_auto',
            tipo_pessoa: tipoPessoa,
            id_pessoa: idPessoa,
            nome_pessoa: result.ok
              ? `${nomePessoa} (acionado por ${device.nome})`
              : `${nomePessoa} (FALHA ao acionar ${abertura.nome})`,
            evento: result.ok ? 'acionado_auto' : 'falha_acionamento',
          });
          if (!result.ok) {
            this.logger.warn(
              `Ponte falhou: leitor ${device.id} identificou ${nomePessoa} mas trigger em ${abertura.id} (${abertura.nome}) deu erro: ${result.error ?? result.statusCode}`,
            );
          }
        } catch (err: any) {
          this.logger.warn(
            `Ponte erro inesperado: leitor ${device.id} → abertura ${abertura.id}: ${err?.message ?? err}`,
          );
        }
      }
    }

    return { ok: true, tipo: tipoPessoa, id: idPessoa, evento };
  }

  async listAcessos(idCondominio: number, limit = 50) {
    const list = await this.prisma.acessos_Facial.findMany({
      where: { id_condominio: idCondominio },
      orderBy: { timestamp: 'desc' },
      take: Math.min(limit, 200),
    });
    return list.map((a) => {
      let observacao = null;
      const match = a.nome_pessoa.match(/\(([^)]+)\)/);
      if (match) {
        observacao = match[1];
      }
      return {
        ...a,
        observacao,
      };
    });
  }

  async listAcessosPessoa(
    tipo: 'morador' | 'visitante',
    idPessoa: number,
    limit = 30,
  ) {
    if (tipo === 'morador') {
      const list = await this.prisma.acessos_Facial.findMany({
        where: { tipo_pessoa: tipo, id_pessoa: idPessoa },
        orderBy: { timestamp: 'desc' },
        take: Math.min(limit, 100),
      });
      return list.map((a) => {
        let observacao = null;
        const match = a.nome_pessoa.match(/\(([^)]+)\)/);
        if (match) {
          observacao = match[1];
        }
        return {
          ...a,
          observacao,
        };
      });
    }

    type MergedEntry = {
      id: number;
      id_condominio: number;
      id_device?: number | null;
      tipo_dispositivo?: string | null;
      face_id?: string | null;
      tipo_pessoa: 'visitante';
      id_pessoa: number;
      nome_pessoa: string;
      evento: 'entrada' | 'saida' | 'negado';
      confianca?: number | null;
      timestamp: Date;
      observacao?: string | null;
    };

    const DEDUP_MS = 15_000;

    // Para o caminho migrado (Pessoas / Visitas): consolida acessos faciais e entradas/saídas por PIN/manual
    if (pessoasMigrationEnabled(this.prisma)) {
      let pessoa: any = null;
      const vis = await this.prisma.visitas.findUnique({
        where: { id: idPessoa },
        include: { pessoa: true },
      });
      if (vis?.pessoa) {
        pessoa = vis.pessoa;
      } else {
        pessoa = await this.prisma.pessoas.findUnique({
          where: { id: idPessoa },
        });
      }

      if (pessoa) {
        const todasVisitas = await this.prisma.visitas.findMany({
          where: {
            id_pessoa: pessoa.id,
            id_condominio: pessoa.id_condominio,
          },
          orderBy: { created_at: 'desc' },
        });
        const todosVisIds = todasVisitas.map((x: any) => x.id);

        const acessosFacial = await this.prisma.acessos_Facial.findMany({
          where: {
            id_condominio: pessoa.id_condominio,
            OR: [
              { tipo_pessoa: 'visitante', id_pessoa: { in: [...todosVisIds, pessoa.id] } },
              { tipo_pessoa: 'prestador', id_pessoa: { in: [...todosVisIds, pessoa.id] } },
              { face_id: `pessoa_${pessoa.id}` },
              ...(pessoa.face_id ? [{ face_id: pessoa.face_id }] : []),
            ],
          },
          orderBy: { timestamp: 'desc' },
          take: 100,
        });

        const facialBuckets = new Set<string>();
        for (const a of acessosFacial) {
          const b = Math.floor(a.timestamp.getTime() / DEDUP_MS);
          facialBuckets.add(`${a.id_pessoa}:${a.evento}:${b}`);
          facialBuckets.add(`${a.id_pessoa}:${a.evento}:${b - 1}`);
          facialBuckets.add(`${a.id_pessoa}:${a.evento}:${b + 1}`);
          facialBuckets.add(`${pessoa.id}:${a.evento}:${b}`);
        }
        const isDup = (idVis: number, evento: 'entrada' | 'saida', ts: Date) => {
          const b = Math.floor(ts.getTime() / DEDUP_MS);
          return (
            facialBuckets.has(`${idVis}:${evento}:${b}`) ||
            facialBuckets.has(`${pessoa.id}:${evento}:${b}`)
          );
        };

        const mergedList: MergedEntry[] = [];

        for (const a of acessosFacial) {
          let observacao = null;
          const match = a.nome_pessoa.match(/\(([^)]+)\)/);
          if (match) {
            observacao = match[1];
          }
          mergedList.push({
            id: a.id,
            id_condominio: a.id_condominio,
            id_device: a.id_device,
            tipo_dispositivo: a.tipo_dispositivo,
            face_id: a.face_id,
            tipo_pessoa: 'visitante',
            id_pessoa: a.id_pessoa ?? pessoa.id,
            nome_pessoa: a.nome_pessoa,
            evento:
              a.evento === 'saida'
                ? 'saida'
                : a.evento === 'negado'
                  ? 'negado'
                  : 'entrada',
            confianca: a.confianca,
            timestamp: a.timestamp,
            observacao,
          });
        }

        for (const reg of todasVisitas) {
          if (reg.data_entrada && !isDup(reg.id, 'entrada', reg.data_entrada)) {
            mergedList.push({
              id: reg.id * 1000 + 1,
              id_condominio: reg.id_condominio,
              tipo_dispositivo: 'pin',
              tipo_pessoa: 'visitante',
              id_pessoa: reg.id,
              nome_pessoa: pessoa.nome,
              evento: 'entrada',
              timestamp: reg.data_entrada,
            });
          }
          if (reg.data_saida && !isDup(reg.id, 'saida', reg.data_saida)) {
            mergedList.push({
              id: reg.id * 1000 + 2,
              id_condominio: reg.id_condominio,
              tipo_dispositivo: 'pin',
              tipo_pessoa: 'visitante',
              id_pessoa: reg.id,
              nome_pessoa: pessoa.nome,
              evento: 'saida',
              timestamp: reg.data_saida,
            });
          }
        }

        mergedList.sort((x, y) => y.timestamp.getTime() - x.timestamp.getTime());
        return mergedList.slice(0, limit);
      }
    }

    // Para visitantes, precisamos consolidar o histórico completo (acessos faciais + PIN/manual) de todas as visitas da mesma identidade
    const v = await this.prisma.visitantes.findUnique({
      where: { id: idPessoa },
    });
    if (!v) return [];

    const todasVisitas = await this.prisma.visitantes.findMany({
      where: {
        id_condominio: v.id_condominio,
        nome: v.nome,
        doc_identificacao: v.doc_identificacao || undefined,
      },
      orderBy: { created_at: 'desc' },
    });
    const todosVisIds = todasVisitas.map((x) => x.id);

    const acessosFacial =
      todosVisIds.length > 0
        ? await this.prisma.acessos_Facial.findMany({
            where: {
              id_condominio: v.id_condominio,
              tipo_pessoa: 'visitante',
              id_pessoa: { in: todosVisIds },
            },
            orderBy: { timestamp: 'desc' },
            take: 100,
          })
        : [];

    // Deduplicação (evita duplicar se casar com acesso facial)
    const facialBuckets = new Set<string>();
    for (const a of acessosFacial) {
      const b = Math.floor(a.timestamp.getTime() / DEDUP_MS);
      facialBuckets.add(`${a.id_pessoa}:${a.evento}:${b}`);
      facialBuckets.add(`${a.id_pessoa}:${a.evento}:${b - 1}`);
      facialBuckets.add(`${a.id_pessoa}:${a.evento}:${b + 1}`);
    }
    const isDup = (idVis: number, evento: 'entrada' | 'saida', ts: Date) => {
      const b = Math.floor(ts.getTime() / DEDUP_MS);
      return facialBuckets.has(`${idVis}:${evento}:${b}`);
    };

    const mergedList: MergedEntry[] = [];

    // Adiciona acessos faciais
    for (const a of acessosFacial) {
      let observacao = null;
      const match = a.nome_pessoa.match(/\(([^)]+)\)/);
      if (match) {
        observacao = match[1];
      }
      mergedList.push({
        id: a.id,
        id_condominio: a.id_condominio,
        id_device: a.id_device,
        tipo_dispositivo: a.tipo_dispositivo,
        face_id: a.face_id,
        tipo_pessoa: 'visitante',
        id_pessoa: a.id_pessoa!,
        nome_pessoa: a.nome_pessoa,
        evento:
          a.evento === 'saida'
            ? 'saida'
            : a.evento === 'negado'
              ? 'negado'
              : 'entrada',
        confianca: a.confianca,
        timestamp: a.timestamp,
        observacao,
      });
    }

    // Adiciona entradas/saídas por PIN/manual
    for (const reg of todasVisitas) {
      if (reg.data_entrada && !isDup(reg.id, 'entrada', reg.data_entrada)) {
        mergedList.push({
          id: reg.id * 1000 + 1,
          id_condominio: reg.id_condominio,
          tipo_dispositivo: 'pin',
          tipo_pessoa: 'visitante',
          id_pessoa: reg.id,
          nome_pessoa: reg.nome,
          evento: 'entrada',
          timestamp: reg.data_entrada,
        });
      }
      if (reg.data_saida && !isDup(reg.id, 'saida', reg.data_saida)) {
        mergedList.push({
          id: reg.id * 1000 + 2,
          id_condominio: reg.id_condominio,
          tipo_dispositivo: 'pin',
          tipo_pessoa: 'visitante',
          id_pessoa: reg.id,
          nome_pessoa: reg.nome,
          evento: 'saida',
          timestamp: reg.data_saida,
        });
      }
    }

    mergedList.sort((x, y) => y.timestamp.getTime() - x.timestamp.getTime());
    return mergedList.slice(0, limit);
  }

  // ---------- Helpers ----------

  private toConfig(device: any): FacialDeviceConfig {
    return {
      id: device.id,
      ip: device.ip,
      porta: device.porta,
      api_user: device.api_user,
      // Idempotente: decifra se vier cifrado; texto puro passa direto.
      api_password: decryptSecret(device.api_password),
      fabricante: normalizarFabricante(device.fabricante),
    };
  }

  private parseExternalId(externalId: string): { tipo: string; id: number } {
    const match = externalId.match(
      /^(morador|visitante|prestador_servico|pessoa)_(\d+)$/,
    );
    if (!match) return { tipo: 'desconhecido', id: 0 };
    return { tipo: match[1], id: Number(match[2]) };
  }

  /**
   * Escolhe o registro de visitante CORRETO quando a mesma credencial (tag/QR)
   * aparece em vários registros da mesma pessoa (várias visitas).
   *
   * - SAÍDA: prioriza quem está DENTRO (data_entrada != null, data_saida == null).
   *   Um findFirst ingênuo pegava um registro sem entrada ativa e negava a saída.
   * - ENTRADA/demais: prioriza quem está liberado e ainda NÃO entrou nem saiu
   *   (a visita "agendada/pronta"); senão o registro mais recente.
   */
  private async findVisitanteByCredencial(
    where: CredencialVisitaWhere,
    evento: string,
  ) {
    const candidatos = await this.prisma.visitantes.findMany({ where });
    if (candidatos.length <= 1) return candidatos[0] ?? null;

    if (evento === 'saida') {
      // Está dentro agora = entrou e não saiu. Entre vários, o de entrada mais recente.
      const dentro = candidatos
        .filter((v) => v.data_entrada && !v.data_saida)
        .sort((a, b) => b.data_entrada!.getTime() - a.data_entrada!.getTime());
      if (dentro.length) return dentro[0];
    } else {
      // Entrada: prefere visita liberada e ainda não usada (sem entrada/saída).
      const prontos = candidatos
        .filter((v) => v.liberado === 1 && !v.data_entrada && !v.data_saida)
        .sort((a, b) => b.id - a.id);
      if (prontos.length) return prontos[0];
    }
    // Fallback: registro mais recente.
    return candidatos.sort((a, b) => b.id - a.id)[0];
  }

  /**
   * Equivalente a `findVisitanteByCredencial`, mas em `Visitas` — usado
   * quando a flag está ligada. `codigo_acesso`/`tag_rfid` moraram para
   * `Visitas` na migração; com a flag ligada esses campos NUNCA mais são
   * escritos em `Visitantes`, então continuar consultando só `Visitantes`
   * (Critical 1, Lote B) faz todo PIN/tag legítimo emitido depois da
   * migração voltar "credencial não encontrada" — negado — no leitor de
   * QR/tag.
   *
   * Mesma disputa de desempate de `findVisitanteByCredencial`: quando a
   * mesma credencial aparece em várias Visitas da mesma pessoa (várias
   * visitas), prioriza quem está DENTRO na saída, e quem está liberado e
   * ainda não usado na entrada.
   */
  private async findVisitaByCredencial(
    where: CredencialVisitaWhere,
    evento: string,
  ) {
    const candidatos = await this.prisma.visitas.findMany({
      where,
      include: { pessoa: true },
    });
    if (candidatos.length <= 1) return candidatos[0] ?? null;

    if (evento === 'saida') {
      const dentro = candidatos
        .filter((v: any) => v.data_entrada && !v.data_saida)
        .sort((a: any, b: any) => b.data_entrada!.getTime() - a.data_entrada!.getTime());
      if (dentro.length) return dentro[0];
    } else {
      const prontos = candidatos
        .filter((v: any) => v.liberado === 1 && !v.data_entrada && !v.data_saida)
        .sort((a: any, b: any) => b.id - a.id);
      if (prontos.length) return prontos[0];
    }
    return candidatos.sort((a: any, b: any) => b.id - a.id)[0];
  }

  /**
   * Ponto único de dispatch da credencial (QR/tag) para visitante/prestador
   * — Critical 1 (Lote B). Os dois chamadores (leitor de QR e de tag, em
   * `runWebhook`) usam este helper em vez de decidir a tabela cada um por
   * conta própria, então não há como um dos dois esquecer o branch da flag.
   *
   * Devolve o id de PESSOA (não de Visita) com a flag ligada — é o espaço de
   * id que o restante de `runWebhook` espera dali pra frente (a checagem de
   * `liberado`/janela/`dias_semana` mais adiante resolve `idPessoa` contra
   * `Pessoas`).
   *
   * Também devolve a própria `Visita` escolhida (`visita`, com `pessoa`
   * incluída) quando migrado. Critical 1 (Lote B): `findVisitaByCredencial`
   * já fez o desempate certo entre as várias Visitas que podem compartilhar a
   * mesma credencial (mesmo `tag_rfid` gravado em todas pelo `atualizarPessoa`).
   * Reconsultar `Pessoas` mais adiante e reeleger via `resolverVisitaAtivaPessoa`
   * (outro critério, sem `orderBy`) podia devolver uma Visita DIFERENTE da que
   * a credencial de fato identificou — quem chama este método deve usar
   * `visita` diretamente como `v`, sem reeleger.
   */
  private async resolverVisitantePorCredencial(
    where: CredencialVisitaWhere,
    evento: string,
  ): Promise<{ idPessoa: number; nome: string; isPrestador: boolean; visita: any | null } | null> {
    if (pessoasMigrationEnabled(this.prisma)) {
      const visita: any = await this.findVisitaByCredencial(where, evento);
      if (!visita) return null;
      return {
        idPessoa: visita.id_pessoa,
        nome: visita.pessoa?.nome ?? 'Desconhecido',
        isPrestador: visita.is_prestador === 1,
        visita,
      };
    }
    const visitante = await this.findVisitanteByCredencial(where, evento);
    if (!visitante) return null;
    return {
      idPessoa: visitante.id,
      nome: visitante.nome,
      isPrestador: visitante.is_prestador === 1,
      visita: null,
    };
  }

  /**
   * Decide entrada/saída/negado do evento considerando o SENTIDO configurado
   * no terminal — peça-chave de um controle de acesso profissional:
   *   - negado continua negado (validação de identidade falhou)
   *   - terminal 'entrada' → sempre entrada
   *   - terminal 'saida'   → sempre saída (dá baixa)
   *   - 'auto'             → respeita o que o aparelho informou (direction/event);
   *                          se não informar, cai em entrada
   */
  private resolveEvento(
    sentido: string | undefined,
    payload: WebhookEventDto,
  ): string {
    const base = this.normalizeEvento(payload.event, payload.direction);
    if (base === 'negado') return 'negado';
    if (sentido === 'entrada') return 'entrada';
    if (sentido === 'saida') return 'saida';
    return base;
  }

  /**
   * Terminal em sentido "auto" cujo evento NÃO traz direção (nem `direction`,
   * nem entrada/saída no `event`). É o caso dos faciais Intelbras/Dahua, que só
   * reportam o reconhecimento. Nesse cenário a direção é alternada pelo último
   * acesso da pessoa (ver runWebhook), em vez de assumir sempre "entrada".
   */
  private isAmbiguousAuto(
    sentido: string | undefined,
    payload: WebhookEventDto,
  ): boolean {
    const autoSentido = !sentido || sentido === 'auto';
    const semDirecao =
      !payload.direction &&
      !/entrada|sa[ií]da|exit|\bin\b|\bout\b/i.test(payload.event ?? '');
    return autoSentido && semDirecao;
  }

  private normalizeEvento(event?: string, direction?: string): string {
    const e = (event ?? '').toLowerCase();
    const d = (direction ?? '').toLowerCase();
    if (e.includes('denied') || e.includes('negado')) return 'negado';
    if (d === 'in' || e.includes('granted') || e.includes('entrada'))
      return 'entrada';
    if (d === 'out' || e.includes('saida') || e.includes('exit'))
      return 'saida';
    return 'entrada';
  }

  /**
   * Foto pronta para o terminal: baixa/decodifica e normaliza para o limite
   * dos faciais (JPEG até 600x1200 e ~95 KB). Foto de câmera (ex.: 900x1600,
   * 121 KB) era recusada pelo aparelho com "Bad Request" e ficava pendente.
   */
  private async fetchPhotoAsBase64(foto: string): Promise<string | null> {
    const bruta = await this.fetchPhotoBrutaAsBase64(foto);
    return bruta ? normalizarFotoParaTerminal(bruta) : bruta;
  }

  private async fetchPhotoBrutaAsBase64(foto: string): Promise<string | null> {
    if (!foto) return null;
    if (foto.startsWith('data:')) {
      const idx = foto.indexOf(',');
      return idx >= 0 ? foto.substring(idx + 1) : foto;
    }
    if (foto.startsWith('http://') || foto.startsWith('https://')) {
      try {
        if (!(await urlExternaSegura(foto))) {
          this.logger.warn('fetchPhotoBruta: URL de foto bloqueada (host interno/inválido).');
          return null;
        }
        const axios = (await import('axios')).default;
        const res = await axios.get((await this.storage?.assinarUrl(foto)) ?? foto, {
          ...agentesSemRedeInterna(), // o IP checado é o IP conectado (DNS rebinding)
          responseType: 'arraybuffer',
          timeout: 15000,
          maxRedirects: 0,
          maxContentLength: 15 * 1024 * 1024,
        });
        return Buffer.from(res.data).toString('base64');
      } catch (err) {
        this.logger.warn(`Falha baixando foto ${foto}: ${err}`);
        return null;
      }
    }
    // Já é base64 puro
    return foto;
  }

  private async markMoradorSyncStatus(id: number, status: string, errorMsg?: string | null) {
    try {
      await this.prisma.moradores.update({
        where: { id },
        data: {
          face_sync_status: status,
          face_sync_error: errorMsg ? errorMsg.slice(0, 500) : null
        },
      });
    } catch {
      /* noop */
    }
  }

  private async markVisitanteSyncStatus(id: number, status: string, errorMsg?: string | null) {
    try {
      await this.prisma.visitantes.update({
        where: { id },
        data: {
          face_sync_status: status,
          face_sync_error: errorMsg ? errorMsg.slice(0, 500) : null
        },
      });
    } catch {
      /* noop */
    }
  }

  private async markPrestadorSyncStatus(id: number, status: string, errorMsg?: string | null) {
    try {
      await this.prisma.prestadores_servico.update({
        where: { id },
        data: {
          face_sync_status: status,
          face_sync_error: errorMsg ? errorMsg.slice(0, 500) : null
        },
      });
    } catch {
      /* noop */
    }
  }
}
