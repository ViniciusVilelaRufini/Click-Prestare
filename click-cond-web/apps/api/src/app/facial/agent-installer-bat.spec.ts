import * as fs from 'fs';
import * as path from 'path';
import { FacialService } from './facial.service';

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
  const conteudo = fs.readFileSync(
    path.resolve(process.cwd(), 'agent', 'install-windows.bat'),
    'utf8',
  );

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
  const conteudo = fs.readFileSync(
    path.resolve(process.cwd(), 'agent', 'run-agent-service.cmd'),
    'utf8',
  );

  it('tem o laço :loop / goto loop', () => {
    expect(conteudo).toContain(':loop');
    expect(conteudo).toContain('goto loop');
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
