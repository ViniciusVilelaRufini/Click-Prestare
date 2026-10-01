import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Conversa, Mensagem, WhatsappApi } from '../whatsapp.service';
import { CrmWhatsappComponent } from './crm-whatsapp.component';

describe('CrmWhatsappComponent (Mídias)', () => {
  let fixture: ComponentFixture<CrmWhatsappComponent>;
  let component: CrmWhatsappComponent;
  let mockApi: {
    conversas: jest.Mock;
    respostas: jest.Mock;
    mensagens: jest.Mock;
    enviar: jest.Mock;
    enviarMidia: jest.Mock;
    urlMidia: jest.Mock;
  };

  const conversaMock: Conversa = {
    id: 1,
    waId: '5511999999999',
    nome: 'Cliente Teste',
    leadId: null,
    ultimaMsgEm: '2026-10-01T10:00:00Z',
    ultimaDoClienteEm: '2026-10-01T10:00:00Z',
    naoLidas: 0,
    trecho: 'Olá',
    janelaAberta: true,
  };

  beforeEach(async () => {
    mockApi = {
      conversas: jest.fn().mockReturnValue(of([conversaMock])),
      respostas: jest.fn().mockReturnValue(of([])),
      mensagens: jest.fn().mockReturnValue(of([])),
      enviar: jest.fn().mockReturnValue(of({})),
      enviarMidia: jest.fn().mockReturnValue(of({})),
      urlMidia: jest.fn((id: number) => `/api/crm/whatsapp/midias/${id}`),
    };

    await TestBed.configureTestingModule({
      imports: [CrmWhatsappComponent],
      providers: [
        provideRouter([]),
        { provide: WhatsappApi, useValue: mockApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CrmWhatsappComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.abrir(conversaMock);
    fixture.detectChanges();
  });

  it('deve renderizar <audio controls> quando a mensagem for áudio com status pronto', () => {
    const msgAudio: Mensagem = {
      id: 42,
      direcao: 'entrada',
      tipo: 'audio',
      texto: '[áudio recebido]',
      status: 'entregue',
      erro: null,
      criadoEm: '2026-10-01T10:00:00Z',
      mediaChave: 'whatsapp/w1/uuid.ogg',
      mediaMime: 'audio/ogg',
      mediaNome: 'audio.ogg',
      mediaTamanho: 12000,
      mediaStatus: 'pronto',
    };

    mockApi.mensagens.mockReturnValue(of([msgAudio]));
    component.abrir(conversaMock);
    fixture.detectChanges();

    const audioEl = fixture.nativeElement.querySelector('audio[controls]');
    expect(audioEl).toBeTruthy();
    expect(audioEl.getAttribute('src') || audioEl.src).toContain('/crm/whatsapp/midias/42');
  });

  it('deve enviar PDF selecionado via enviarMidia(1, filePdf, \'\')', () => {
    const filePdf = new File(['%PDF-1.4 test'], 'proposta.pdf', { type: 'application/pdf' });
    const msgSaida: Mensagem = {
      id: 99,
      direcao: 'saida',
      tipo: 'document',
      texto: '[document enviada]',
      status: 'enviada',
      erro: null,
      criadoEm: '2026-10-01T10:05:00Z',
      mediaStatus: 'enviada',
      mediaNome: 'proposta.pdf',
    };
    mockApi.enviarMidia.mockReturnValue(of(msgSaida));

    const input = fixture.nativeElement.querySelector('input[type="file"]');
    expect(input).toBeTruthy();

    Object.defineProperty(input, 'files', {
      value: [filePdf],
      writable: true,
    });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(component.anexo()).toBe(filePdf);

    component.enviar();
    fixture.detectChanges();

    expect(mockApi.enviarMidia).toHaveBeenCalledWith(1, filePdf, '');
  });

  it('deve renderizar imagem e link de download para documento', () => {
    const msgImagem: Mensagem = {
      id: 101,
      direcao: 'entrada',
      tipo: 'image',
      texto: '[imagem recebida]',
      status: 'entregue',
      erro: null,
      criadoEm: '2026-10-01T10:00:00Z',
      mediaChave: 'whatsapp/w1/img.jpg',
      mediaMime: 'image/jpeg',
      mediaNome: 'foto.jpg',
      mediaStatus: 'pronto',
    };
    const msgDoc: Mensagem = {
      id: 102,
      direcao: 'saida',
      tipo: 'document',
      texto: 'Segue anexo',
      status: 'enviada',
      erro: null,
      criadoEm: '2026-10-01T10:01:00Z',
      mediaChave: 'whatsapp/w1/doc.pdf',
      mediaMime: 'application/pdf',
      mediaNome: 'contrato.pdf',
      mediaTamanho: 1048576,
      mediaStatus: 'enviada',
    };

    mockApi.mensagens.mockReturnValue(of([msgImagem, msgDoc]));
    component.abrir(conversaMock);
    fixture.detectChanges();

    const imgEl = fixture.nativeElement.querySelector('img');
    expect(imgEl).toBeTruthy();
    expect(imgEl.getAttribute('src')).toContain('/crm/whatsapp/midias/101');

    const linkDoc = fixture.nativeElement.querySelector('a[download]');
    expect(linkDoc).toBeTruthy();
    expect(linkDoc.getAttribute('href')).toContain('/crm/whatsapp/midias/102');
    expect(fixture.nativeElement.textContent).toContain('contrato.pdf');
    expect(fixture.nativeElement.textContent).toContain('1.0 MB');
    expect(fixture.nativeElement.textContent).toContain('Segue anexo');
  });

  it('deve exibir indicador de mídia indisponível quando mediaStatus for indisponivel ou falhou', () => {
    const msgIndisponivel: Mensagem = {
      id: 55,
      direcao: 'entrada',
      tipo: 'audio',
      texto: '[áudio recebido]',
      status: 'entregue',
      erro: 'S3 indisponível',
      criadoEm: '2026-10-01T10:00:00Z',
      mediaStatus: 'indisponivel',
    };

    mockApi.mensagens.mockReturnValue(of([msgIndisponivel]));
    component.abrir(conversaMock);
    fixture.detectChanges();

    const audioEl = fixture.nativeElement.querySelector('audio[controls]');
    expect(audioEl).toBeNull();

    const textoHtml = fixture.nativeElement.textContent;
    expect(textoHtml).toMatch(/indisponível/i);
  });

  it('deve permitir remover anexo antes de enviar', () => {
    const filePdf = new File(['%PDF-1.4 test'], 'proposta.pdf', { type: 'application/pdf' });
    component.selecionarArquivo({ target: { files: [filePdf] } } as any);
    expect(component.anexo()).toBe(filePdf);

    component.removerAnexo();
    expect(component.anexo()).toBeNull();
  });
});
