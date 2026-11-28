import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import type { ChamadaHoje, ResultadoChamada } from './interfone.api';
import { InterfoneApi } from './interfone.api';
import { InterfoneStore } from './interfone.store';
import { ChamadasHojeComponent } from './chamadas-hoje.component';

function ch(id: number, resultado: ResultadoChamada | null, extra: Partial<ChamadaHoje> = {}): ChamadaHoje {
  return {
    id,
    tipo: 'facial_unidade',
    inicio: '2026-11-28T13:00:00.000Z',
    resultado,
    atendida_por_nome: null,
    foto_url: null,
    porta_aberta: false,
    unidade: 'Bloco A · Apto 106',
    id_apartamento: 100,
    ...extra,
  };
}

const HOJE: ChamadaHoje[] = [
  ch(3, 'falha', { tipo: 'portaria_unidade' }),
  ch(2, 'nao_atendida', { unidade: 'Sem unidade', id_apartamento: null }),
  ch(1, 'atendida_morador', {
    atendida_por_nome: 'Ana Souza',
    porta_aberta: true,
    porta_aberta_por_nome: 'Ana Souza',
    foto_url: 'https://s3/foto.jpg',
  }),
];

function montar(api: Partial<Record<'dia', jest.Mock>> = {}) {
  const store = {
    hoje: signal<ChamadaHoje[]>(HOJE),
    tocando: signal<unknown[]>([]),
    emChamada: signal<unknown>(null),
    discando: signal(false),
    atendendo: signal<number | null>(null),
    ligar: jest.fn(() => Promise.resolve()),
  };
  const apiFalsa = { dia: api.dia ?? jest.fn(() => of([ch(9, 'recusada', { unidade: 'Bloco D · Apto 109', id_apartamento: 109 })])) };
  TestBed.configureTestingModule({
    imports: [ChamadasHojeComponent],
    providers: [
      { provide: InterfoneStore, useValue: store },
      { provide: InterfoneApi, useValue: apiFalsa },
    ],
  });
  const f = TestBed.createComponent(ChamadasHojeComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const linhas = () => Array.from(el.querySelectorAll('[data-teste="chamada"]')) as HTMLElement[];
  const cartao = (id: string) => el.querySelector(`[data-filtro="${id}"]`) as HTMLButtonElement;
  const botao = (texto: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === texto) as HTMLButtonElement;
  const escolherDia = (v: string) => {
    const input = el.querySelector('input[type="date"]') as HTMLInputElement;
    input.value = v;
    input.dispatchEvent(new Event('change'));
    f.detectChanges();
  };
  return { f, el, store, api: apiFalsa, linhas, cartao, botao, escolherDia };
}

describe('ChamadasHojeComponent', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(Date.UTC(2026, 10, 28, 13, 0)));
  });
  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('números do dia em cartões', () => {
    const { cartao } = montar();
    const n = (id: string) => cartao(id).textContent?.replace(/\D+/g, '');
    expect([n('todas'), n('atendidas'), n('sem_resposta'), n('falhas'), n('portoes')]).toEqual(['3', '1', '1', '1', '1']);
  });

  it('linha mostra tipo, resultado, quem atendeu e quem abriu o portão', () => {
    const { linhas } = montar();
    const ultima = linhas()[2].textContent ?? '';
    expect(ultima).toContain('Bloco A · Apto 106');
    expect(ultima).toContain('Portão → unidade');
    expect(ultima).toContain('Atendida');
    expect(ultima).toContain('atendida por Ana Souza');
    expect(ultima).toContain('Portão aberto por Ana Souza');
    expect(linhas()[0].querySelector('[data-teste="resultado"] .ps-dot-danger')).not.toBeNull();
    expect(linhas()[1].querySelector('[data-teste="resultado"] .ps-dot-warn')).not.toBeNull();
  });

  it('facial_portaria: "Portão → portaria", sem unidade mostra "Portaria" e o ícone do portão (câmera)', () => {
    const { f, linhas, store } = montar();
    store.hoje.set([ch(5, 'atendida_portaria', { tipo: 'facial_portaria', unidade: '', id_apartamento: null })]);
    f.detectChanges();
    const linha = linhas()[0];
    expect(linha.textContent).toContain('Portão → portaria');
    expect(linha.querySelector('p.text-sm')?.textContent?.trim()).toBe('Portaria');
    const d = linha.querySelector('.ps-avatar svg path')?.getAttribute('d') ?? '';
    expect(d.startsWith('M15.75 10.5')).toBe(true);
  });

  it('cartão filtra; clicar de novo volta para todas; filtro vazio tem mensagem própria', () => {
    const { f, el, cartao, linhas, store } = montar();
    cartao('falhas').click();
    f.detectChanges();
    expect(cartao('falhas').getAttribute('aria-pressed')).toBe('true');
    expect(linhas()).toHaveLength(1);
    cartao('falhas').click();
    f.detectChanges();
    expect(linhas()).toHaveLength(3);

    store.hoje.set([ch(1, 'atendida_morador')]);
    cartao('falhas').click();
    f.detectChanges();
    expect(el.textContent).toContain('Nenhuma chamada neste filtro.');
  });

  it('ligar de volta usa a unidade da chamada e respeita a chamada em curso; sem unidade não há botão', () => {
    const { f, linhas, store } = montar();
    expect(linhas()[1].querySelector('[data-teste="ligar-de-volta"]')).toBeNull();
    const ligar = linhas()[0].querySelector('[data-teste="ligar-de-volta"]') as HTMLButtonElement;
    ligar.click();
    expect(store.ligar).toHaveBeenCalledWith(100, 'Bloco A · Apto 106');
    store.emChamada.set({ id: 1 });
    f.detectChanges();
    expect(ligar.disabled).toBe(true);
  });

  it('foto abre ampliada e fecha com Esc', () => {
    const { f, el } = montar();
    (el.querySelector('[data-teste="abrir-foto"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('[role="dialog"] img')?.getAttribute('src')).toBe('https://s3/foto.jpg');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('chamada chegando fecha a foto ampliada (o painel da chamada fica livre)', () => {
    const { f, el, store } = montar();
    (el.querySelector('[data-teste="abrir-foto"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('[role="dialog"]')).not.toBeNull();
    store.tocando.set([{ id: 77 }]);
    f.detectChanges();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('dia anterior: busca na API, mostra a faixa e volta para hoje', () => {
    const { el, api, linhas, botao, f, store, escolherDia } = montar();
    const input = el.querySelector('input[type="date"]') as HTMLInputElement;
    expect(input.min).toBe('2026-10-29');
    expect(input.max).toBe('2026-11-28');

    escolherDia('2026-11-20');
    expect(api.dia).toHaveBeenCalledWith('2026-11-20');
    expect(el.querySelector('[data-teste="faixa-dia"]')?.textContent).toContain('Vendo 20/11');
    expect(linhas().map((l) => l.textContent)).toEqual([expect.stringContaining('Bloco D · Apto 109')]);

    // A lista de hoje continua mudando no store, mas a tela mostra o dia escolhido.
    store.hoje.set([]);
    f.detectChanges();
    expect(linhas()).toHaveLength(1);

    botao('Voltar para hoje').click();
    store.hoje.set(HOJE);
    f.detectChanges();
    expect(el.querySelector('[data-teste="faixa-dia"]')).toBeNull();
    expect(linhas()).toHaveLength(3);
  });

  it('dia fora do limite volta para hoje sem chamar a API; falha na API mostra aviso', () => {
    const dia = jest.fn(() => throwError(() => new Error('x')));
    const { el, escolherDia } = montar({ dia });
    escolherDia('2026-10-01');
    expect(dia).not.toHaveBeenCalled();
    expect((el.querySelector('input[type="date"]') as HTMLInputElement).value).toBe('2026-11-28');
    expect(el.querySelector('[data-teste="faixa-dia"]')).toBeNull();
    escolherDia('2026-11-27');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível carregar as chamadas desse dia.');
    expect(el.textContent).toContain('Nenhuma chamada neste dia.');
  });
});
