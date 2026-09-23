import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ConfiguracoesPageComponent } from './configuracoes-page.component';

/**
 * "Nível de permissão" era `turno ? 'Portaria' : 'Gestor'`: o síndico logado
 * na portaria-web tem turno "Síndico" e aparecia como PORTARIA logo abaixo do
 * próprio "SÍNDICO". E o formulário de senha só dizia o que estava errado
 * depois de clicar em salvar.
 */
describe('ConfiguracoesPageComponent — perfil e senha', () => {
  function build(): ConfiguracoesPageComponent {
    TestBed.configureTestingModule({
      imports: [ConfiguracoesPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    return TestBed.createComponent(ConfiguracoesPageComponent).componentInstance;
  }

  it.each([
    ['Síndico', 'Síndico'],
    ['Diurno', 'Portaria'],
    ['Porteiro (App)', 'Portaria'],
    [null, 'Gestor'],
  ])('turno %s → nível %s', (turno, nivel) => {
    expect(build().nivelPermissao(turno as any)).toBe(nivel);
  });

  it('checklist da nova senha acompanha o que foi digitado', () => {
    const tela = build();
    tela.senhaAtual = 'QA_atual';
    tela.novaSenha = '12345';
    tela.confirmarSenha = '1234';
    expect(tela.requisitosSenha()).toEqual({ tamanho: false, confere: false });
    expect(tela.podeSalvarSenha()).toBe(false);

    tela.novaSenha = '123456';
    tela.confirmarSenha = '123456';
    expect(tela.requisitosSenha()).toEqual({ tamanho: true, confere: true });
    expect(tela.podeSalvarSenha()).toBe(true);
  });

  it('sem a senha atual não habilita', () => {
    const tela = build();
    tela.novaSenha = '123456';
    tela.confirmarSenha = '123456';
    expect(tela.podeSalvarSenha()).toBe(false);
  });
});
