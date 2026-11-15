import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { DocumentosPageComponent } from './documentos-page.component';
import { DocumentosApi } from './documentos.service';
import { AuthService } from '../auth/auth.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * Sem zone.js, o FileReader termina fora de um evento da tela: se nada marcar a
 * tela para redesenhar, "Disponibilizar" fica desabilitado e o nome sugerido
 * não aparece até o usuário fazer outra coisa.
 */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}
const SINDICO = jwt({ sub: 7, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' });

describe('DocumentosPageComponent — arquivo lido pelo FileReader', () => {
  it('habilita "Disponibilizar" e sugere o nome assim que o arquivo termina de ser lido', async () => {
    TestBed.configureTestingModule({
      imports: [DocumentosPageComponent],
      providers: [
        { provide: DocumentosApi, useValue: { listDocumentos: jest.fn(() => of([])), insertDocumento: jest.fn(() => of({})), removeDocumento: jest.fn(() => of({})) } },
        { provide: ConfirmService, useValue: { ask: jest.fn(async () => true) } },
        { provide: AuthService, useValue: { porteiroInfo: signal({ nome: 'X', turno: 'Diurno', id_condominio: 1 }), token: SINDICO } },
      ],
    });
    const fixture = TestBed.createComponent(DocumentosPageComponent);
    fixture.autoDetectChanges();
    const comp = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    comp.abrirModalUpload();
    await fixture.whenStable();
    const botao = () =>
      [...el.querySelectorAll('button')].find((b) => /Disponibilizar/.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(botao().disabled).toBe(true);

    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'Regimento 2026.pdf', { type: 'application/pdf' });
    comp.onFileSelected({ target: { files: [pdf] } });
    await new Promise((ok) => setTimeout(ok, 20));
    await fixture.whenStable();

    expect(botao().disabled).toBe(false);
    const nome = el.querySelector('input[type="text"], input:not([type])') as HTMLInputElement | null;
    expect(comp.novoDoc.nome).toBe('Regimento 2026');
    if (nome) expect(nome.value).toBe('Regimento 2026');
  });
});
