import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { DocumentosPageComponent } from './documentos-page.component';
import { DocumentosApi } from './documentos.service';
import { AuthService } from '../auth/auth.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * Documentos no console:
 *  - qualquer erro da API virava uma lista de documentos FALSOS (links para
 *    example.com), sem aviso. Agora o erro aparece e nada é inventado;
 *  - o porteiro via "Publicar" e "Excluir", a API recusava (assertStaff) e o
 *    clique falhava calado; "Excluir" apagava sem confirmar.
 */

/** JWT de mentira (só o payload importa para a tela). */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}
const SINDICO = jwt({ sub: 7, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' });
const PORTEIRO = jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Diurno', tipo_sub: 'funcionario_portaria' });
const DOC = { id: 5, nome: 'Regimento 2026', link_doc: 'https://bucket/documentos/x.pdf' };

describe('DocumentosApi.listDocumentos — sem documentos falsos', () => {
  it('erro da API chega como erro, não como lista inventada', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { get: jest.fn(() => throwError(() => ({ status: 500 }))) } },
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1 }) } },
      ],
    });
    const api = TestBed.inject(DocumentosApi);
    const next = jest.fn();
    const error = jest.fn();
    api.listDocumentos(false).subscribe({ next, error });
    api.listDocumentos(true).subscribe({ next, error });
    expect(next).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(2);
    TestBed.resetTestingModule();
  });
});

describe('DocumentosPageComponent — erros, papel e confirmação', () => {
  function render(token: string, extra: Partial<Record<string, any>> = {}, confirma = true) {
    const api: any = {
      listDocumentos: jest.fn(() => of([DOC])),
      insertDocumento: jest.fn(() => of({})),
      removeDocumento: jest.fn(() => of({})),
      ...extra,
    };
    const confirm = { ask: jest.fn(async () => confirma) };
    TestBed.configureTestingModule({
      imports: [DocumentosPageComponent],
      providers: [
        { provide: DocumentosApi, useValue: api },
        { provide: ConfirmService, useValue: confirm },
        { provide: AuthService, useValue: { porteiroInfo: signal({ nome: 'X', turno: 'Diurno', id_condominio: 1 }), token } },
      ],
    });
    const fixture = TestBed.createComponent(DocumentosPageComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, api, comp: fixture.componentInstance, confirm };
  }

  const botao = (el: HTMLElement, texto: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim().includes(texto));

  afterEach(() => TestBed.resetTestingModule());

  it('lista com erro: sai do spinner e mostra a mensagem', () => {
    const { fixture, el, comp } = render(SINDICO, {
      listDocumentos: jest.fn(() => throwError(() => ({ error: { message: 'Acesso negado.' } }))),
    });
    fixture.detectChanges();
    expect(comp.loading()).toBe(false);
    expect(el.textContent).toContain('Acesso negado.');
    expect(el.textContent).not.toContain('Nenhum documento publicado');
  });

  it('porteiro: consulta, sem Publicar e sem Excluir', () => {
    const { el } = render(PORTEIRO);
    expect(el.textContent).toContain('Regimento 2026');
    expect(botao(el, 'Publicar Documento')).toBeUndefined();
    expect(botao(el, 'Excluir')).toBeUndefined();
  });

  it('síndico: vê Publicar e Excluir', () => {
    const { el } = render(SINDICO);
    expect(botao(el, 'Publicar Documento')).toBeTruthy();
    expect(botao(el, 'Excluir')).toBeTruthy();
  });

  it('publicar com erro: o drawer fica aberto e mostra a mensagem dentro dele', () => {
    const { fixture, el, comp } = render(SINDICO, {
      insertDocumento: jest.fn(() => throwError(() => ({ error: { message: 'Arquivo inválido.' } }))),
    });
    comp.abrirModalUpload();
    comp.novoDoc = { nome: 'Regimento', isAta: false, base64: 'data:application/pdf;base64,JVBERi0=' };
    comp.salvarDocumento();
    fixture.detectChanges();
    expect(comp.modalUpload()).toBe(true);
    expect(el.querySelector('.ps-drawer')?.textContent).toContain('Arquivo inválido.');
  });

  it('enquanto publica: Cancelar e × desabilitados, e o drawer não fecha', () => {
    const pendente = new Subject<unknown>();
    const { fixture, el, comp } = render(SINDICO, { insertDocumento: jest.fn(() => pendente) });
    comp.abrirModalUpload();
    comp.novoDoc = { nome: 'Regimento', isAta: false, base64: 'data:application/pdf;base64,JVBERi0=' };
    comp.salvarDocumento();
    fixture.detectChanges();
    const drawer = el.querySelector('.ps-drawer') as HTMLElement;
    expect((botao(drawer, 'Cancelar') as HTMLButtonElement).disabled).toBe(true);
    expect((drawer.querySelector('button[aria-label="Fechar"]') as HTMLButtonElement).disabled).toBe(true);
    comp.fecharUpload();
    expect(comp.modalUpload()).toBe(true);
    pendente.next({});
    pendente.complete();
    fixture.detectChanges();
    expect(comp.modalUpload()).toBe(false);
  });

  it('excluir pede confirmação (danger) e não apaga se cancelar', async () => {
    const { comp, api, confirm } = render(SINDICO, {}, false);
    await comp.removerDocumento(DOC as any);
    expect(confirm.ask).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
    expect(api.removeDocumento).not.toHaveBeenCalled();
  });

  it('excluir confirmado chama a API; erro aparece na tela', async () => {
    const { fixture, el, comp, api } = render(SINDICO, {
      removeDocumento: jest.fn(() => throwError(() => ({ error: { message: 'Não removeu.' } }))),
    });
    await comp.removerDocumento(DOC as any);
    fixture.detectChanges();
    expect(api.removeDocumento).toHaveBeenCalledWith(5);
    expect(el.textContent).toContain('Não removeu.');
  });

  it('documento sem arquivo (ATA antiga gravada sem PDF): não promete download nem mostra Abrir', () => {
    const { el } = render(SINDICO, { listDocumentos: jest.fn(() => of([{ id: 8, nome: 'ATA AGO - 01/01/2026', link_doc: '' }])) });
    expect(el.textContent).not.toContain('Disponível para download');
    expect(el.textContent).toContain('Sem arquivo');
    expect(Array.from(el.querySelectorAll('a')).find((a) => a.textContent?.includes('Abrir'))).toBeUndefined();
  });

  it('selo do cartão sai da extensão do arquivo: a apuração (.txt, URL assinada) mostra TXT, a ATA mostra PDF', () => {
    const { el } = render(SINDICO, {
      listDocumentos: jest.fn(() => of([
        { id: 1, nome: 'ATA AGO', link_doc: 'https://bucket/atas/1-a.pdf?X-Amz-Signature=abc' },
        { id: 2, nome: 'Apuração das pautas - ATA AGO', link_doc: 'https://bucket/atas/2-b.txt?X-Amz-Signature=abc' },
      ])),
    });
    const selos = Array.from(el.querySelectorAll('[data-selo-arquivo]')).map((s) => s.textContent?.trim());
    expect(selos).toEqual(['PDF', 'TXT']);
  });
});
