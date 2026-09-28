import { blocoColideComReserva } from './areas-sociais.service';

/**
 * A lista de horários livres só tirava o bloco com horário IDÊNTICO ao de uma
 * reserva ativa: com 14:00–18:00 reservado, o bloco 08:00–23:59 continuava
 * sendo oferecido e só o POST recusava.
 */
describe('blocoColideComReserva', () => {
  const reserva = { horaDe: '14:00', horaAte: '18:00' };

  it('bloco que contém a reserva colide', () => {
    expect(blocoColideComReserva({ horarioDe: '08:00', horarioAte: '23:59' }, reserva)).toBe(true);
  });

  it('bloco idêntico colide', () => {
    expect(blocoColideComReserva({ horarioDe: '14:00', horarioAte: '18:00' }, reserva)).toBe(true);
  });

  it('bloco depois da reserva não colide', () => {
    expect(blocoColideComReserva({ horarioDe: '18:00', horarioAte: '22:00' }, reserva)).toBe(false);
  });

  it('bloco antes da reserva não colide', () => {
    expect(blocoColideComReserva({ horarioDe: '08:00', horarioAte: '14:00' }, reserva)).toBe(false);
  });
});
