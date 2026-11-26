import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { AreasSociaisPageComponent } from './areas-sociais-page.component';
import { AreaSocial, AreasSociaisApi } from './areas-sociais.service';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';

/**
 * Grade de horários do espaço editável no console (antes só pelo app,
 * new_area_social.dart). Mesmo formato que o app grava: 7 dias, índice 0 =
 * segunda, `{ nome, horarios: [{ horarioDe, horarioAte }] }`; "24:00" é o fim
 * do último bloco da noite. Validação: fim depois do início, sem bloco
 * atravessando a meia-noite e sem sobreposição no mesmo dia.
 */
const NOMES = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

function gradeDoApp(): any[] {
  return NOMES.map((nome, i) => ({
    nome,
    horarios: i === 6 ? [] : [{ horarioDe: '08:00', horarioAte: '12:00' }, { horarioDe: '14:00', horarioAte: '18:00' }],
  }));
}

function build() {
  const api = {
    listAreas: jest.fn(() => of([])),
    listAgendamentos: jest.fn(() => of([])),
    insertArea: jest.fn(() => of({ success: true })),
    updateArea: jest.fn(() => of({ success: true })),
  };
  TestBed.configureTestingModule({
    imports: [AreasSociaisPageComponent],
    providers: [
      { provide: AreasSociaisApi, useValue: api },
      { provide: ApartamentosApi, useValue: { list: jest.fn(() => of([])) } },
      { provide: ConfirmService, useValue: { ask: jest.fn(() => Promise.resolve(true)) } },
      { provide: AuthService, useValue: { porteiroInfo: signal(null), token: null } },
    ],
  });
  const f = TestBed.createComponent(AreasSociaisPageComponent);
  f.detectChanges();
  return { f, tela: f.componentInstance, api, el: f.nativeElement as HTMLElement };
}

const AREA: AreaSocial = { id: 30, nome: 'Quadra', imagem: '', horarios: gradeDoApp() } as AreaSocial;

describe('AreasSociaisPageComponent — grade de horários do espaço', () => {
  it('cadastro: começa sem horários, não salva assim; o atalho preenche 08:00–22:00 nos 7 dias', () => {
    const { tela, api } = build();
    tela.abrirModalArea();
    tela.novaArea.nome = 'Salão';
    expect(tela.gradeTemHorario()).toBe(false);
    tela.salvarArea();
    expect(api.insertArea).not.toHaveBeenCalled();
    tela.preencherHorarioComercial();
    tela.salvarArea();
    const enviado = (api.insertArea.mock.calls[0] as any[])[0];
    expect(enviado.horarios).toEqual(NOMES.map((nome) => ({ nome, horarios: [{ horarioDe: '08:00', horarioAte: '22:00' }] })));
  });

  it('I6: espaço sem reserva (agendar desligado) salva sem grade de horários', () => {
    const { tela, api } = build();
    tela.abrirModalArea();
    tela.novaArea.nome = 'Academia';
    tela.novaArea.agendar = false;
    expect(tela.exigeGradeParaSalvar()).toBe(false);
    tela.salvarArea();
    expect(api.insertArea).toHaveBeenCalledTimes(1);
    expect((api.insertArea.mock.calls[0] as any[])[0]).toMatchObject({ agendar: 0 });
  });

  it('edição: carrega a grade do espaço, adiciona e remove bloco e manda a grade nova', () => {
    const { tela, api } = build();
    tela.abrirModalEditarArea(AREA);
    expect(tela.grade[0].horarios).toEqual([{ horarioDe: '08:00', horarioAte: '12:00' }, { horarioDe: '14:00', horarioAte: '18:00' }]);

    // Próximo bloco começa no fim do último, com a mesma duração.
    tela.adicionarBloco(0);
    expect(tela.grade[0].horarios[2]).toEqual({ horarioDe: '18:00', horarioAte: '22:00' });
    tela.removerBloco(0, 0);
    tela.adicionarBloco(6); // domingo vazio
    expect(tela.grade[6].horarios).toEqual([{ horarioDe: '08:00', horarioAte: '09:00' }]);

    tela.salvarArea();
    const enviado = (api.updateArea.mock.calls[0] as any[])[0];
    expect(enviado.horarios[0]).toEqual({
      nome: 'Segunda',
      horarios: [{ horarioDe: '14:00', horarioAte: '18:00' }, { horarioDe: '18:00', horarioAte: '22:00' }],
    });
    expect(enviado.horarios[6].horarios).toEqual([{ horarioDe: '08:00', horarioAte: '09:00' }]);
    expect(enviado.horarios).toHaveLength(7);
  });

  it('término 00:00 escolhido no campo vira 24:00 (fim do dia), e 24:00 aparece como 00:00', () => {
    const { tela } = build();
    tela.abrirModalArea();
    tela.adicionarBloco(0);
    tela.definirHora(0, 0, 'horarioDe', '20:00');
    tela.definirHora(0, 0, 'horarioAte', '00:00');
    expect(tela.grade[0].horarios[0]).toEqual({ horarioDe: '20:00', horarioAte: '24:00' });
    expect(tela.horaNoCampo('24:00')).toBe('00:00');
    expect(tela.erroDoDia(0)).toBeNull();
    expect(tela.gradeValida()).toBe(true);
  });

  it('próximo bloco depois de um que termina 24:00 não passa da meia-noite', () => {
    const { tela } = build();
    tela.abrirModalArea();
    tela.adicionarBloco(0);
    tela.definirHora(0, 0, 'horarioAte', '00:00'); // 08:00–24:00
    tela.adicionarBloco(0);
    const novo = tela.grade[0].horarios[1];
    expect(novo.horarioDe < novo.horarioAte || novo.horarioAte === '24:00').toBe(true);
  });

  it.each([
    ['fim antes do início', [{ horarioDe: '18:00', horarioAte: '10:00' }], 'meia-noite'],
    ['fim igual ao início', [{ horarioDe: '10:00', horarioAte: '10:00' }], 'depois do início'],
    ['atravessa a meia-noite', [{ horarioDe: '22:00', horarioAte: '02:00' }], 'meia-noite'],
    ['blocos sobrepostos', [{ horarioDe: '08:00', horarioAte: '12:00' }, { horarioDe: '11:00', horarioAte: '13:00' }], 'sobrep'],
    ['hora vazia', [{ horarioDe: '', horarioAte: '12:00' }], 'Preencha'],
  ])('%s: mostra o erro e não salva', (_caso, blocos, trecho) => {
    const { f, tela, api, el } = build();
    tela.abrirModalArea();
    tela.novaArea.nome = 'Salão';
    tela.grade[2].horarios = blocos.map((b) => ({ ...b }));
    f.detectChanges();
    expect(tela.erroDoDia(2)).toContain(trecho);
    expect(tela.gradeValida()).toBe(false);
    expect(el.textContent).toContain(tela.erroDoDia(2) as string);
    tela.salvarArea();
    expect(api.insertArea).not.toHaveBeenCalled();
  });

  it('blocos encostados (12:00–14:00 e 14:00–16:00) não são sobreposição', () => {
    const { tela } = build();
    tela.abrirModalArea();
    tela.grade[1].horarios = [{ horarioDe: '14:00', horarioAte: '16:00' }, { horarioDe: '12:00', horarioAte: '14:00' }];
    expect(tela.erroDoDia(1)).toBeNull();
  });

  it('edição de espaço que veio sem grade: sem mexer, a grade não vai no payload', () => {
    const { tela, api } = build();
    tela.abrirModalEditarArea({ id: 31, nome: 'Academia', imagem: '' } as AreaSocial);
    tela.salvarArea();
    const enviado = (api.updateArea.mock.calls[0] as any[])[0];
    expect('horarios' in enviado).toBe(false);
  });

  it('a tela mostra os dias e o botão de adicionar horário', () => {
    const { f, tela, el } = build();
    tela.abrirModalEditarArea(AREA);
    f.detectChanges();
    expect(el.textContent).toContain('Horários de funcionamento');
    expect(el.textContent).toContain('Domingo');
    expect(el.textContent).toContain('Sem horários');
    expect(Array.from(el.querySelectorAll('button')).some((b) => b.textContent?.includes('Adicionar horário'))).toBe(true);
  });
});
