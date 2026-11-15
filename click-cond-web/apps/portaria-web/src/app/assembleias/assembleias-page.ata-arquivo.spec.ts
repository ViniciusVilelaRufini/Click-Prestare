import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { AssembleiasPageComponent } from './assembleias-page.component';
import { AssembleiasApi } from './assembleias.service';
import { AuthService } from '../auth/auth.service';
import { ConfirmService } from '../shared/confirm.service';
import { ServerClockService } from '../core/server-clock.service';

/**
 * O console roda sem zone.js: o FileReader termina fora de um evento da tela.
 * Se o PDF lido fosse guardado num campo comum, o botão "Finalizar e publicar
 * ATA" ficava desabilitado para sempre (achado no teste em produção, 15/11).
 */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}
const SINDICO = jwt({ sub: 7, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' });
const ASSEMBLEIA = { id: 2, titulo: 'AGE', data: '20/11/2026', hora: '19:30' };

function lerArquivoEsperado(): Promise<void> {
  return new Promise((ok) => setTimeout(ok, 20));
}

describe('AssembleiasPageComponent — PDF da ATA lido pelo FileReader', () => {
  it('habilita "Finalizar e publicar ATA" depois que o PDF termina de ser lido, sem outro evento', async () => {
    TestBed.configureTestingModule({
      imports: [AssembleiasPageComponent],
      providers: [
        {
          provide: AssembleiasApi,
          useValue: {
            listAssembleias: jest.fn(() => of([ASSEMBLEIA])),
            listEnquetes: jest.fn(() => of([])),
            getAssembleia: jest.fn(() => of({ assembleia: ASSEMBLEIA, votacoes: [], meusVotos: [] })),
          },
        },
        { provide: ConfirmService, useValue: { ask: jest.fn(async () => true) } },
        { provide: AuthService, useValue: { porteiroInfo: signal({ nome: 'X', turno: 'Diurno', id_condominio: 1 }), token: SINDICO } },
        { provide: ServerClockService, useValue: { agora: () => new Date('2026-11-13T15:00:00Z') } },
      ],
    });
    const fixture = TestBed.createComponent(AssembleiasPageComponent);
    fixture.autoDetectChanges();
    const comp = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    comp.verAssembleia(2);
    comp.abrirFinalizar(ASSEMBLEIA as any);
    await fixture.whenStable();

    const botao = () =>
      [...el.querySelectorAll('button')].find((b) => /Finalizar e publicar ATA/i.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(botao().disabled).toBe(true);

    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'ata.pdf', { type: 'application/pdf' });
    comp.onAtaSelecionada({ target: { files: [pdf] } });
    await lerArquivoEsperado();
    await fixture.whenStable();

    expect(botao().disabled).toBe(false);
  });
});
