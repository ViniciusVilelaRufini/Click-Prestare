import * as fs from 'fs';
import * as path from 'path';
import { COMANDO_AJUSTE_TAREFA, FacialService, LINHAS_ECHO_LACO_SERVICO } from './facial.service';

/** Linhas de um .bat (CRLF ou LF), sem o terminador. */
function linhasDe(texto: string): string[] {
  return texto.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}

/** O bloco "(" ... ") > <destino>" que escreve o run-agent-service.cmd. */
function blocoEcho(texto: string, fechamento: string): string[] {
  const linhas = linhasDe(texto);
  const fim = linhas.indexOf(fechamento);
  expect(fim).toBeGreaterThan(-1);
  let ini = fim - 1;
  while (ini >= 0 && linhas[ini] !== '(') ini--;
  expect(ini).toBeGreaterThan(-1);
  return linhas.slice(ini + 1, fim);
}

/**
 * O que o cmd.exe escreve para cada "echo" do bloco: `%%` vira `%` (em
 * qualquer lugar), `^x` vira `x` fora de aspas, e `echo:` e linha vazia.
 * Suficiente para as linhas do laco (sem expansao atrasada, sem `^` literal) —
 * e a execucao de verdade no cmd.exe esta registrada no relatorio da revisao.
 */
function saidaDoEcho(linha: string): string {
  if (linha === 'echo:') return '';
  expect(linha.startsWith('echo ')).toBe(true);
  const corpo = linha.slice('echo '.length).replace(/%%/g, '%');
  let out = '';
  let emAspas = false;
  for (let i = 0; i < corpo.length; i++) {
    const c = corpo[i];
    if (c === '"') emAspas = !emAspas;
    if (c === '^' && !emAspas && i + 1 < corpo.length) {
      out += corpo[++i];
      continue;
    }
    out += c;
  }
  return out;
}

const TEMPLATE_CMD = fs.readFileSync(path.resolve(process.cwd(), 'agent', 'run-agent-service.cmd'), 'utf8');
const INSTALL_WINDOWS_BAT = fs.readFileSync(path.resolve(process.cwd(), 'agent', 'install-windows.bat'), 'utf8');

/**
 * O instalador do portal (getAgentConfigFile(..., 'bat')) baixado pelo
 * síndico/porteiro passou a gerar também `run-agent-service.cmd` (tarefa 9):
 * a tarefa agendada aponta para ELE, não mais direto para o .exe, para que
 * o agente sobreviva a crash/atualização (laço `:loop` / `goto loop` — é
 * exatamente o que `atualizador.js` confere via `/goto\s+loop/i` antes de
 * trocar o executável) e recupere sozinho de uma troca de atualização que
 * parou no meio (só sobrou `click-agent.old.exe` no disco).
 *
 * A rotação do log (`agent-service.log` > 5 MB → `agent-service.1.log`) é
 * feita AQUI, no laço do .cmd, e não dentro do agente: o `>>` que lança o
 * exe abre o arquivo antes do processo existir e segura o handle durante
 * toda a execução — o agente tentando renomear seu próprio stdout herdado
 * falha com EBUSY (reproduzido nesta revisão). Entre uma execução e a
 * próxima, dentro do laço, ninguém segura o arquivo.
 */
describe('FacialService.getAgentConfigFile(bat) — laço de reinício (tarefa 9)', () => {
  // FacialService.constructor agenda vários setTimeout/setInterval (tick de
  // dia da semana, expiração automática etc.) — fake timers (mesmo padrão de
  // parse-external-id.spec.ts) evita handles reais presos e o processo do
  // jest não fechando sozinho no fim da suíte.
  let conteudo: string;

  beforeAll(async () => {
    jest.useFakeTimers();
    const prisma: any = {
      condominios: {
        findUnique: jest.fn(async () => ({ nome: 'Condomínio Teste', agent_token: 'token-fixo-123' })),
        update: jest.fn(),
      },
    };
    const service = new FacialService(
      prisma,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
    );
    const arquivo = await service.getAgentConfigFile(7, 'https://api.exemplo.com.br', 'bat');
    conteudo = arquivo.content;
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('escreve run-agent-service.cmd (não só o .env) antes de registrar a tarefa', () => {
    expect(conteudo).toContain('set "CMDFILE=%DIR%run-agent-service.cmd"');
    expect(conteudo).toContain(') > "%CMDFILE%"');
  });

  it('a tarefa agendada (schtasks /TR) aponta para o .cmd, não direto para o .exe', () => {
    expect(conteudo).toMatch(/schtasks \/Create .* \/TR "\\"%CMDFILE%\\""/);
    expect(conteudo).not.toMatch(/\/TR "\\"%EXE%\\""/);
  });

  it('o .cmd gerado tem o laço :loop / goto loop (contrato do atualizador.js)', () => {
    expect(conteudo).toContain('echo :loop');
    expect(conteudo).toContain('echo goto loop');
    // O mesmo regex que atualizador.js usa para decidir se pode trocar o exe.
    const linhaLaco = conteudo
      .split(/\r?\n/)
      .filter((l) => l.startsWith('echo '))
      .map((l) => l.slice('echo '.length))
      .join('\n');
    expect(/goto\s+loop/i.test(linhaLaco)).toBe(true);
  });

  it('o .cmd gerado recupera click-agent.old.exe quando falta o click-agent.exe', () => {
    expect(conteudo).toContain('echo if not exist "%%~dp0click-agent.exe" if exist "%%~dp0click-agent.old.exe" ^(');
    expect(conteudo).toContain('echo   ren "%%~dp0click-agent.old.exe" "click-agent.exe"');
  });

  it('o .cmd gerado confia no repositório de certificados do Windows (TLS)', () => {
    expect(conteudo).toContain('echo set "NODE_USE_SYSTEM_CA=1"');
  });

  it('o .cmd gerado usa "ping" (não "timeout") para esperar entre reinícios — timeout falha sem console', () => {
    expect(conteudo).toContain('echo ping -n 6 127.0.0.1 ^>nul');
    expect(conteudo).not.toMatch(/echo timeout \/t/);
  });

  it('o .env continua sendo gravado com API_URL e AGENT_TOKEN do condomínio', () => {
    expect(conteudo).toContain('echo API_URL=https://api.exemplo.com.br');
    expect(conteudo).toContain('echo AGENT_TOKEN=token-fixo-123');
  });

  it('I3: para a tarefa e o processo ANTES de baixar e de reescrever o .cmd (upgrade de instalação antiga)', () => {
    const linhas = linhasDe(conteudo);
    const idxEnd = linhas.indexOf('schtasks /End /TN "ClickPortariaAgent" >nul 2>&1');
    const idxKill = linhas.indexOf('taskkill /F /IM click-agent.exe >nul 2>&1');
    const idxDownload = linhas.findIndex((l) => l.includes('Invoke-WebRequest'));
    const idxCmd = linhas.indexOf(') > "%CMDFILE%"');
    const idxRun = linhas.indexOf('schtasks /Run /TN "ClickPortariaAgent"');
    expect(idxEnd).toBeGreaterThan(-1);
    expect(idxKill).toBeGreaterThan(idxEnd);
    expect(idxDownload).toBeGreaterThan(idxKill);
    expect(idxCmd).toBeGreaterThan(idxDownload);
    expect(idxRun).toBeGreaterThan(idxCmd);
  });

  it('I3: baixa SEMPRE (não pula quando o exe já existe) para click-agent.new.exe e move por cima do exe', () => {
    expect(conteudo).toContain('set "NOVO=%DIR%click-agent.new.exe"');
    const download = linhasDe(conteudo).find((l) => l.includes('Invoke-WebRequest'))!;
    expect(download).toContain(
      "-Uri 'https://github.com/Viniciusvile/Click-Prestare/releases/latest/download/click-agent.exe'",
    );
    expect(download).toContain("-OutFile '%NOVO%'");
    // O antigo "if not exist %EXE% ( baixa )" deixava instalações antigas
    // presas na versão velha para sempre.
    expect(conteudo).not.toMatch(/if not exist "%EXE%" \(\r\n\s+echo Baixando/);
    expect(conteudo).toContain('if exist "%NOVO%" move /y "%NOVO%" "%EXE%" >nul');
    // Download que falha não pode deixar um .new.exe pela metade nem apagar o exe atual.
    expect(conteudo).toContain('  if exist "%NOVO%" del "%NOVO%"');
  });

  it('I3: instalação manual descarta auto-atualização pendente (atualizacao.json / contador de falhas)', () => {
    expect(conteudo).toContain('if exist "%DIR%atualizacao.json" del "%DIR%atualizacao.json"');
    expect(conteudo).toContain('if exist "%DIR%atualizacao-falhas.txt" del "%DIR%atualizacao-falhas.txt"');
  });

  it('I4: depois do /Create, tira o limite de 72h e as condições de bateria (Set-ScheduledTask)', () => {
    const linhas = linhasDe(conteudo);
    const idxCreate = linhas.findIndex((l) => l.startsWith('schtasks /Create '));
    const idxAjuste = linhas.indexOf(`${COMANDO_AJUSTE_TAREFA} >nul`);
    const idxRun = linhas.indexOf('schtasks /Run /TN "ClickPortariaAgent"');
    expect(COMANDO_AJUSTE_TAREFA).toBe(
      'powershell -NoProfile -Command "Set-ScheduledTask -TaskName ClickPortariaAgent -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1))"',
    );
    expect(idxAjuste).toBeGreaterThan(idxCreate);
    expect(idxRun).toBeGreaterThan(idxAjuste);
  });

  it('o bloco que escreve o .cmd é IDÊNTICO ao de agent/install-windows.bat', () => {
    expect(blocoEcho(conteudo, ') > "%CMDFILE%"')).toEqual([...LINHAS_ECHO_LACO_SERVICO]);
    expect(blocoEcho(INSTALL_WINDOWS_BAT, ') > "%~dp0run-agent-service.cmd"')).toEqual([
      ...LINHAS_ECHO_LACO_SERVICO,
    ]);
  });

  it('o .cmd que o bloco escreve é exatamente agent/run-agent-service.cmd (template versionado)', () => {
    expect(LINHAS_ECHO_LACO_SERVICO.map(saidaDoEcho)).toEqual(linhasDe(TEMPLATE_CMD));
  });

  it('o .cmd gerado rotaciona agent-service.log (>5MB) para agent-service.1.log DENTRO do laço, antes de lançar o exe', () => {
    // A linha vem ANTES do "set NODE_USE_SYSTEM_CA=1" / lançamento do exe —
    // é o que garante que nenhum processo está segurando o arquivo quando
    // o "move" roda.
    const idxRotacao = conteudo.indexOf('move /y "%%~dp0agent-service.log" "%%~dp0agent-service.1.log"');
    const idxLancamento = conteudo.indexOf('"%%~dp0click-agent.exe" ^>^>');
    expect(idxRotacao).toBeGreaterThan(-1);
    expect(idxLancamento).toBeGreaterThan(-1);
    expect(idxRotacao).toBeLessThan(idxLancamento);
    expect(conteudo).toContain(
      'echo for %%%%A in ^("%%~dp0agent-service.log"^) do if %%%%~zA GTR 5242880 move /y "%%~dp0agent-service.log" "%%~dp0agent-service.1.log" ^>nul',
    );
  });
});

/**
 * O instalador local (agent/install-windows.bat) gera o MESMO
 * run-agent-service.cmd que o instalador do portal (getAgentConfigFile
 * acima) — os dois textos são lidos direto do disco aqui (não passam por
 * nenhum framework) porque install-windows.bat não é código TypeScript.
 */
describe('agent/install-windows.bat — mesmo laço de reinício e rotação de log', () => {
  const conteudo = INSTALL_WINDOWS_BAT;

  it('gera o run-agent-service.cmd com o laço :loop / goto loop', () => {
    expect(conteudo).toContain('echo :loop');
    expect(conteudo).toContain('echo goto loop');
  });

  it('recupera click-agent.old.exe quando falta o click-agent.exe', () => {
    expect(conteudo).toContain('echo if not exist "%%~dp0click-agent.exe" if exist "%%~dp0click-agent.old.exe" ^(');
    expect(conteudo).toContain('echo   ren "%%~dp0click-agent.old.exe" "click-agent.exe"');
  });

  it('rotaciona agent-service.log (>5MB) para agent-service.1.log DENTRO do laço, antes de lançar o exe', () => {
    const idxRotacao = conteudo.indexOf('move /y "%%~dp0agent-service.log" "%%~dp0agent-service.1.log"');
    const idxLancamento = conteudo.indexOf('"%%~dp0click-agent.exe" ^>^>');
    expect(idxRotacao).toBeGreaterThan(-1);
    expect(idxLancamento).toBeGreaterThan(-1);
    expect(idxRotacao).toBeLessThan(idxLancamento);
    expect(conteudo).toContain(
      'echo for %%%%A in ^("%%~dp0agent-service.log"^) do if %%%%~zA GTR 5242880 move /y "%%~dp0agent-service.log" "%%~dp0agent-service.1.log" ^>nul',
    );
  });

  it('confia no repositório de certificados do Windows e usa "ping" (não "timeout") entre reinícios', () => {
    expect(conteudo).toContain('echo set "NODE_USE_SYSTEM_CA=1"');
    expect(conteudo).toContain('echo ping -n 6 127.0.0.1 ^>nul');
  });

  it('a tarefa agendada (schtasks /TR) aponta para run-agent-service.cmd, não direto para o .exe', () => {
    expect(conteudo).toMatch(/schtasks \/Create .* \/TR "\\"%~dp0run-agent-service\.cmd\\""/);
  });

  it('I3: para a tarefa e o processo ANTES de reescrever o .cmd', () => {
    const linhas = linhasDe(conteudo);
    const idxEnd = linhas.findIndex((l) => l.startsWith('schtasks /End '));
    const idxKill = linhas.indexOf('taskkill /F /IM click-agent.exe >nul 2>&1');
    const idxCmd = linhas.indexOf(') > "%~dp0run-agent-service.cmd"');
    expect(idxEnd).toBeGreaterThan(-1);
    expect(idxKill).toBeGreaterThan(idxEnd);
    expect(idxCmd).toBeGreaterThan(idxKill);
  });

  it('I4: depois do /Create, aplica o mesmo ajuste de tarefa do instalador do portal', () => {
    const linhas = linhasDe(conteudo);
    const idxCreate = linhas.findIndex((l) => l.startsWith('schtasks /Create '));
    const idxAjuste = linhas.indexOf(`${COMANDO_AJUSTE_TAREFA} >nul`);
    expect(idxCreate).toBeGreaterThan(-1);
    expect(idxAjuste).toBeGreaterThan(idxCreate);
  });

  it('tasklist procura o bundle atual (click-agent.cjs), não o index.js antigo', () => {
    expect(conteudo).toContain('click-agent.cjs');
    expect(conteudo).not.toContain('index.js');
  });
});

/**
 * O template versionado (agent/run-agent-service.cmd) é o que já sai pronto
 * junto do repositório/exe — mesmo contrato dos dois geradores acima.
 */
describe('agent/run-agent-service.cmd — template versionado', () => {
  const conteudo = TEMPLATE_CMD;

  it('tem o laço :loop / goto loop', () => {
    expect(conteudo).toContain(':loop');
    expect(conteudo).toContain('goto loop');
  });

  it('I5: com atualizacao.json presente, conta saídas com erro e na 3ª volta o click-agent.old.exe', () => {
    const linhas = linhasDe(conteudo);
    const idxExe = linhas.indexOf('"%~dp0click-agent.exe" >> "%~dp0agent-service.log" 2>&1');
    expect(linhas[idxExe + 1]).toBe('set "SAIDA=%errorlevel%"');
    const trecho = linhas.slice(idxExe).join('\n');
    expect(trecho).toContain('if "%SAIDA%"=="0" goto espera');
    expect(trecho).toContain('if not exist "%~dp0atualizacao.json" goto espera');
    expect(trecho).toContain('if %FALHAS% LSS 3 goto espera');
    expect(trecho).toContain('move /y "%~dp0click-agent.exe" "%~dp0click-agent.bad.exe" >nul');
    expect(trecho).toContain('move /y "%~dp0click-agent.old.exe" "%~dp0click-agent.exe" >nul');
    // atualizacao.json NÃO é apagado pelo .cmd: o exe antigo o lê e marca a
    // versão nova como recusada (atualizador.js, verificarInicializacao).
    expect(conteudo).not.toMatch(/del "%~dp0atualizacao\.json"/);
    // Sem atualização pendente o contador zera (não sobra de uma vez anterior).
    expect(conteudo).toContain(
      'if not exist "%~dp0atualizacao.json" if exist "%~dp0atualizacao-falhas.txt" del "%~dp0atualizacao-falhas.txt"',
    );
  });

  it('rotaciona o log ANTES de lançar o exe (nenhum processo segura o arquivo nesse ponto)', () => {
    const idxRotacao = conteudo.indexOf('move /y "%~dp0agent-service.log" "%~dp0agent-service.1.log"');
    const idxLancamento = conteudo.indexOf('"%~dp0click-agent.exe" >>');
    expect(idxRotacao).toBeGreaterThan(-1);
    expect(idxLancamento).toBeGreaterThan(-1);
    expect(idxRotacao).toBeLessThan(idxLancamento);
    expect(conteudo).toContain(
      'for %%A in ("%~dp0agent-service.log") do if %%~zA GTR 5242880 move /y "%~dp0agent-service.log" "%~dp0agent-service.1.log" >nul',
    );
  });
});
