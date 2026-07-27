import { Component, inject, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { ThemeService } from '../shared/theme.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div 
      class="min-h-screen app-bg flex relative overflow-hidden font-sans transition-colors duration-500"
      [ngClass]="isLight() ? 'light' : ''"
    >
      
      <!-- Botão de Alternar Tema (Light/Dark Mode) -->
      <button
        type="button"
        (click)="toggleTheme()"
        class="absolute top-6 right-6 z-50 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 shadow-md active:scale-95 border"
        [ngClass]="isLight() 
          ? 'bg-white/80 border-slate-200 text-slate-700 hover:bg-slate-50' 
          : 'bg-slate-900/60 border-white/10 text-slate-400 hover:text-white hover:border-accent/40'"
        title="Alternar Tema"
      >
        @if (isLight()) {
          <!-- Ícone de Sol / Modo Claro Ativo (Mostra opção de mudar para Escuro) -->
          <svg class="w-5 h-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464-4.95a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 1.414l-.707.707zm-9.9 9.9a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 1.414l-.707.707zm0-9.9a1 1 0 011.414 0l.707.707a1 1 0 11-1.414 1.414l-.707-.707a1 1 0 010-1.414zm9.9 9.9a1 1 0 010 1.414l-.707.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-12 0a1 1 0 100-2H4a1 1 0 100 2h1z" clip-rule="evenodd" />
          </svg>
        } @else {
          <!-- Ícone de Lua / Modo Escuro Ativo (Mostra opção de mudar para Claro) -->
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
          </svg>
        }
      </button>

      <!-- Círculos de Brilho de Fundo (Glow Effects) -->
      <div 
        class="absolute -top-40 -left-40 w-96 h-96 rounded-full blur-[120px] pointer-events-none transition-opacity duration-500"
        [ngClass]="isLight() ? 'bg-blue-500/5 opacity-80' : 'bg-blue-600/10'"
      ></div>
      <div 
        class="absolute -bottom-40 -right-40 w-96 h-96 rounded-full blur-[120px] pointer-events-none transition-opacity duration-500"
        [ngClass]="isLight() ? 'bg-accent/5 opacity-80' : 'bg-accent/15'"
      ></div>
      
      <!-- Grid Decorativo -->
      <div 
        class="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-30 pointer-events-none transition-opacity duration-500"
        [ngClass]="isLight() ? 'opacity-[0.07]' : 'opacity-30'"
      ></div>

      <!-- Container Principal -->
      <div class="w-full flex">
        
        <!-- Painel Esquerdo (Apresentação Corporativa - Visível apenas em telas grandes) -->
        <div 
          class="hidden lg:flex lg:w-[55%] border-r relative p-16 flex-col justify-between overflow-hidden transition-all duration-300"
          [ngClass]="isLight() ? 'bg-slate-50/40 border-slate-200' : 'bg-slate-900/40 border-white/5'"
        >
          <div class="absolute inset-0 bg-gradient-to-br from-accent/5 via-blue-500/0 to-transparent pointer-events-none"></div>
          
          <!-- Logo Prestare / Click -->
          <div class="relative flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-accent/10 border border-accent/25 flex items-center justify-center shadow-lg shadow-accent/5">
              <svg class="w-5 h-5 text-accent animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
              </svg>
            </div>
            <span 
              class="text-lg font-bold tracking-tight uppercase transition-colors duration-300"
              [ngClass]="isLight() ? 'text-slate-800' : 'text-white'"
            >
              Prestare <span class="text-accent font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-accent to-blue-500">Click</span>
            </span>
          </div>

          <!-- Hero Message -->
          <div class="relative space-y-6 max-w-lg my-auto">
            <span class="px-3 py-1 rounded-full bg-accent/10 border border-accent/25 text-[10px] text-accent font-semibold tracking-wider uppercase inline-block">
              Console Portaria Inteligente
            </span>
            <h2 
              class="text-4xl lg:text-5xl font-extrabold tracking-tight leading-[1.15] transition-colors duration-300"
              [ngClass]="isLight() ? 'text-slate-800' : 'text-white'"
            >
              A inteligência operacional que <span class="bg-gradient-to-r from-accent to-blue-500 bg-clip-text text-transparent">conecta seu condomínio</span>
            </h2>
            <p 
              class="text-sm leading-relaxed font-light transition-colors duration-300"
              [ngClass]="isLight() ? 'text-slate-500' : 'text-slate-400'"
            >
              Acesse a plataforma corporativa oficial da Click Portaria e gerencie fluxos de correspondências, visitantes, prestadores de serviços e ocorrências com rastreabilidade absoluta e conformidade corporativa.
            </p>

            <div class="grid grid-cols-2 gap-4 pt-4">
              <div class="flex items-center gap-2.5">
                <div class="w-5 h-5 rounded-md bg-accent/10 flex items-center justify-center shrink-0">
                  <svg class="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <span 
                  class="text-xs font-medium transition-colors duration-300"
                  [ngClass]="isLight() ? 'text-slate-700' : 'text-slate-300'"
                >Controle de Acesso</span>
              </div>
              <div class="flex items-center gap-2.5">
                <div class="w-5 h-5 rounded-md bg-accent/10 flex items-center justify-center shrink-0">
                  <svg class="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <span 
                  class="text-xs font-medium transition-colors duration-300"
                  [ngClass]="isLight() ? 'text-slate-700' : 'text-slate-300'"
                >Gestão de Encomendas</span>
              </div>
              <div class="flex items-center gap-2.5">
                <div class="w-5 h-5 rounded-md bg-accent/10 flex items-center justify-center shrink-0">
                  <svg class="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <span 
                  class="text-xs font-medium transition-colors duration-300"
                  [ngClass]="isLight() ? 'text-slate-700' : 'text-slate-300'"
                >Ocorrências Ativas</span>
              </div>
              <div class="flex items-center gap-2.5">
                <div class="w-5 h-5 rounded-md bg-accent/10 flex items-center justify-center shrink-0">
                  <svg class="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <span 
                  class="text-xs font-medium transition-colors duration-300"
                  [ngClass]="isLight() ? 'text-slate-700' : 'text-slate-300'"
                >Relatórios Gerenciais</span>
              </div>
            </div>
          </div>

          <!-- Footer Corporativo -->
          <div 
            class="relative text-xs flex justify-between items-center transition-colors duration-300"
            [ngClass]="isLight() ? 'text-slate-400' : 'text-slate-500'"
          >
            <span>© 2026 Prestare Gestão e Tecnologia. Todos os direitos reservados.</span>
            <a href="https://prestaregestao.com.br/novo/" target="_blank" class="hover:text-accent transition font-medium">prestaregestao.com.br</a>
          </div>
        </div>

        <!-- Painel Direito (Formulário ou QR Code) -->
        <div 
          class="w-full lg:w-[45%] flex flex-col justify-center items-center px-6 md:px-16 py-12 transition-colors duration-500"
          [ngClass]="isLight() ? 'bg-white/75' : 'bg-slate-950/70'"
        >
          
          <div class="w-full max-w-md space-y-8">
            
            <!-- Header de Mobile (Visível apenas em telas pequenas) -->
            <div class="text-center lg:hidden">
              <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 mb-3 shadow-lg shadow-accent/5">
                <svg class="w-6 h-6 text-accent animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                </svg>
              </div>
              <h1 
                class="text-2xl font-bold tracking-tight transition-colors duration-300"
                [ngClass]="isLight() ? 'text-slate-800' : 'text-white'"
              >
                Prestare <span class="text-accent">Click</span>
              </h1>
              <p 
                class="text-xs mt-1 transition-colors duration-300"
                [ngClass]="isLight() ? 'text-slate-500' : 'text-slate-400'"
              >
                Acesso restrito ao console de portaria
              </p>
            </div>

            <!-- MODO CONVENCIONAL DE LOGIN -->
            @if (!isQrMode()) {
              <div class="hidden lg:block space-y-2">
                <h2 
                  class="text-3xl font-extrabold tracking-tight transition-colors duration-300"
                  [ngClass]="isLight() ? 'text-slate-800' : 'text-white'"
                >
                  Painel de Acesso
                </h2>
                <p 
                  class="text-sm font-light transition-colors duration-300"
                  [ngClass]="isLight() ? 'text-slate-500' : 'text-slate-400'"
                >
                  Entre com as suas credenciais para iniciar o turno.
                </p>
              </div>

              <form (ngSubmit)="onSubmit()" class="space-y-5">
                
                <div class="space-y-2">
                  <label 
                    class="block text-xs font-semibold uppercase tracking-wider transition-colors duration-300"
                    [ngClass]="isLight() ? 'text-slate-500' : 'text-slate-400'"
                  >Identificador / Usuário</label>
                  <div class="relative group">
                    <span class="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500 pointer-events-none group-focus-within:text-accent transition">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                      </svg>
                    </span>
                    <input
                      type="text"
                      [(ngModel)]="loginValue"
                      name="login"
                      autocomplete="username"
                      class="w-full border rounded-xl pl-10 pr-4 py-3.5 text-xs transition shadow-inner focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                      [ngClass]="isLight() 
                        ? 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400' 
                        : 'bg-slate-900/60 border-white/10 text-white placeholder-slate-600'"
                      placeholder="Ex: portaria_centro"
                      required
                    />
                  </div>
                </div>

                <div class="space-y-2">
                  <div class="flex items-center justify-between">
                    <label 
                      class="block text-xs font-semibold uppercase tracking-wider transition-colors duration-300"
                      [ngClass]="isLight() ? 'text-slate-500' : 'text-slate-400'"
                    >Senha de Segurança</label>
                  </div>
                  <div class="relative group">
                    <span class="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500 pointer-events-none group-focus-within:text-accent transition">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                      </svg>
                    </span>
                    <input
                      type="password"
                      [(ngModel)]="senhaValue"
                      name="senha"
                      autocomplete="current-password"
                      class="w-full border rounded-xl pl-10 pr-4 py-3.5 text-xs transition shadow-inner focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                      [ngClass]="isLight() 
                        ? 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400' 
                        : 'bg-slate-900/60 border-white/10 text-white placeholder-slate-600'"
                      placeholder="••••••••"
                      required
                    />
                  </div>
                </div>

                <!-- Erro de Login -->
                @if (erro()) {
                  <div class="flex items-center gap-2.5 text-xs text-rose-400 bg-rose-400/10 border border-rose-400/20 rounded-xl px-4 py-3 animate-fadeIn">
                    <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2"
                        d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                    </svg>
                    <span>{{ erro() }}</span>
                  </div>
                }

                <!-- Botão Entrar -->
                <button
                  type="submit"
                  [disabled]="carregando()"
                  class="w-full bg-accent hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed
                         text-white font-semibold text-sm rounded-xl px-4 py-3.5 transition shadow-lg shadow-accent/15
                         active:scale-[0.98]"
                >
                  @if (carregando()) {
                    <span class="flex items-center justify-center gap-2">
                      <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>Processando Acesso...</span>
                    </span>
                  } @else {
                    <span>Entrar no Sistema</span>
                  }
                </button>

                <!-- Divisor Visual para Opção QR Code -->
                <div class="relative flex py-2 items-center">
                  <div 
                    class="flex-grow border-t transition-colors duration-300"
                    [ngClass]="isLight() ? 'border-slate-200' : 'border-white/5'"
                  ></div>
                  <span 
                    class="flex-shrink mx-4 text-[10px] font-semibold uppercase tracking-wider transition-colors duration-300"
                    [ngClass]="isLight() ? 'text-slate-400' : 'text-slate-600'"
                  >Ou acesse pelo celular</span>
                  <div 
                    class="flex-grow border-t transition-colors duration-300"
                    [ngClass]="isLight() ? 'border-slate-200' : 'border-white/5'"
                  ></div>
                </div>

                <!-- Botão Entrar via QR Code -->
                <button
                  type="button"
                  (click)="toggleQrMode(true)"
                  class="w-full border font-semibold text-xs rounded-xl px-4 py-3.5 transition flex items-center justify-center gap-2 active:scale-[0.98]"
                  [ngClass]="isLight() 
                    ? 'bg-slate-50 border-slate-200 hover:border-accent/40 text-slate-700' 
                    : 'bg-slate-900/60 border-white/10 hover:border-accent/40 text-slate-300'"
                >
                  <svg class="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M4 8h4m-4 4h.01M4 16h4m-4 4h.01M6 4h.01M6 16h.01M6 20h.01" />
                  </svg>
                  <span>Acessar via QR Code (App)</span>
                </button>
              </form>
            }

            <!-- MODO QR CODE DE LOGIN -->
            @if (isQrMode()) {
              <div class="space-y-6 text-center animate-fadeIn">
                <div class="space-y-2 text-left">
                  <h2 
                    class="text-3xl font-extrabold tracking-tight transition-colors duration-300"
                    [ngClass]="isLight() ? 'text-slate-800' : 'text-white'"
                  >
                    Entrar com QR Code
                  </h2>
                  <p 
                    class="text-xs font-light leading-relaxed transition-colors duration-300"
                    [ngClass]="isLight() ? 'text-slate-500' : 'text-slate-400'"
                  >
                    Escaneie o código abaixo com a câmera do seu celular através do aplicativo <strong>Click Condomínio</strong> para se conectar automaticamente.
                  </p>
                </div>

                <!-- Container do QR Code com Glow -->
                <div 
                  class="relative w-64 h-64 mx-auto border rounded-2xl flex items-center justify-center overflow-hidden group shadow-lg transition-all duration-300"
                  [ngClass]="isLight() 
                    ? 'bg-white border-slate-200 shadow-slate-200/50' 
                    : 'bg-slate-900 border-white/10 shadow-blue-500/10'"
                >
                  @if (qrToken()) {
                    @if (qrExpired()) {
                      <div class="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center gap-3">
                        <span class="text-xs font-semibold text-slate-400">QR Code Expirado</span>
                        <button
                          type="button"
                          (click)="gerarNovoQr()"
                          class="bg-accent hover:bg-accent-600 text-white text-xs font-bold px-4 py-2 rounded-xl transition shadow-lg shadow-accent/25 active:scale-[0.96]"
                        >
                          Recarregar
                        </button>
                      </div>
                    }
                    <img
                      [src]="'https://api.qrserver.com/v1/create-qr-code/?size=250x250&color=' + (isLight() ? '0a1628' : 'ffffff') + '&bgcolor=' + (isLight() ? 'ffffff' : '0f172a') + '&data=' + qrToken()"
                      alt="QR Code de Acesso"
                      class="w-52 h-52 transition-transform duration-500 group-hover:scale-105"
                    />
                  } @else {
                    <div class="flex flex-col items-center gap-2.5">
                      <div class="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
                      <span class="text-[10px] text-slate-500 uppercase tracking-wider">Gerando código seguro...</span>
                    </div>
                  }
                </div>

                <!-- Status do Polling -->
                <div class="flex items-center justify-center gap-2.5 text-xs text-slate-400">
                  @if (!qrExpired()) {
                    <span class="relative flex h-2 w-2">
                      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                      <span class="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                    </span>
                    <span [ngClass]="isLight() ? 'text-slate-500' : 'text-slate-400'">Aguardando leitura do celular...</span>
                  } @else {
                    <span class="h-2 w-2 rounded-full bg-rose-500"></span>
                    <span [ngClass]="isLight() ? 'text-slate-500' : 'text-slate-400'">Código expirado. Por favor, recarregue.</span>
                  }
                </div>

                <!-- Instruções Detalhadas (Passo a Passo) -->
                <div 
                  class="border rounded-xl p-4 text-left space-y-2.5 max-w-sm mx-auto transition-all duration-300"
                  [ngClass]="isLight() 
                    ? 'bg-slate-50/80 border-slate-200/80' 
                    : 'bg-slate-900/40 border-white/5'"
                >
                  <div class="flex items-start gap-2.5">
                    <span class="w-4 h-4 rounded-full bg-accent/20 text-accent text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                    <p 
                      class="text-[11px] font-light transition-colors duration-300"
                      [ngClass]="isLight() ? 'text-slate-600' : 'text-slate-300'"
                    >Abra o app no celular como <strong>Síndico</strong> ou <strong>Porteiro</strong>.</p>
                  </div>
                  <div class="flex items-start gap-2.5">
                    <span class="w-4 h-4 rounded-full bg-accent/20 text-accent text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
                    <p 
                      class="text-[11px] font-light transition-colors duration-300"
                      [ngClass]="isLight() ? 'text-slate-600' : 'text-slate-300'"
                    >Acesse o menu <strong>Configurações</strong> e toque em <strong>Acesso Web por QR Code</strong>.</p>
                  </div>
                  <div class="flex items-start gap-2.5">
                    <span class="w-4 h-4 rounded-full bg-accent/20 text-accent text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
                    <p 
                      class="text-[11px] font-light transition-colors duration-300"
                      [ngClass]="isLight() ? 'text-slate-600' : 'text-slate-300'"
                    >Aponte a câmera para o QR Code acima e confirme no celular.</p>
                  </div>
                </div>

                <!-- Botão Voltar -->
                <button
                  type="button"
                  (click)="toggleQrMode(false)"
                  class="text-xs font-semibold transition"
                  [ngClass]="isLight() ? 'text-slate-500 hover:text-accent' : 'text-slate-500 hover:text-accent'"
                >
                  Voltar para Login convencional
                </button>
              </div>
            }

            <!-- Footer Corporativo para Mobile -->
            <div 
              class="text-center lg:hidden pt-8 border-t space-y-1 transition-colors duration-300"
              [ngClass]="isLight() ? 'border-slate-200' : 'border-white/5'"
            >
              <p class="text-[10px] text-slate-600">© 2026 Prestare Gestão e Tecnologia</p>
              <a href="https://prestaregestao.com.br/novo/" target="_blank" class="text-[10px] text-slate-500 hover:text-accent transition">prestaregestao.com.br</a>
            </div>

          </div>

        </div>

      </div>

    </div>
  `,
})
export class LoginPageComponent implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private theme = inject(ThemeService);

  loginValue = '';
  senhaValue = '';
  carregando = signal(false);
  erro = signal('');

  // Theme State
  readonly isLight = this.theme.isLight;

  // QR Code States
  isQrMode = signal(false);
  qrToken = signal('');
  qrExpired = signal(false);
  private pollingTimer: any = null;

  constructor() {}

  ngOnDestroy() {
    this.clearPolling();
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }

  onSubmit() {
    if (!this.loginValue || !this.senhaValue) return;
    this.carregando.set(true);
    this.erro.set('');

    this.auth.login(this.loginValue, this.senhaValue).subscribe({
      next: () => this.router.navigate([this.destinoPosLogin()]),
      error: (err) => {
        this.carregando.set(false);
        this.erro.set(
          err.status === 401
            ? 'Login ou senha incorretos'
            : 'Falha na conexão com o servidor',
        );
      },
    });
  }

  /**
   * Síndico com mais de um condomínio precisa dizer em qual quer entrar — antes
   * a web escolhia o primeiro vínculo sozinha. Porteiro e síndico de um só
   * condomínio seguem direto para o console.
   */
  private destinoPosLogin(): string {
    return this.auth.temMultiplosCondominios() ? '/selecionar-condominio' : '/';
  }

  toggleQrMode(active: boolean) {
    this.isQrMode.set(active);
    this.erro.set('');
    if (active) {
      this.iniciarSessaoQr();
    } else {
      this.clearPolling();
    }
  }

  gerarNovoQr() {
    this.iniciarSessaoQr();
  }

  private iniciarSessaoQr() {
    this.clearPolling();
    this.qrToken.set('');
    this.qrExpired.set(false);

    this.http.post<{ qrToken: string; expiresAt: string }>('/api/auth/qr/session', {}).subscribe({
      next: (res) => {
        this.qrToken.set(res.qrToken);
        this.startPolling(res.qrToken);
      },
      error: () => {
        this.erro.set('Falha ao gerar sessão de QR Code.');
        this.isQrMode.set(false);
      }
    });
  }

  private startPolling(token: string) {
    this.pollingTimer = setInterval(() => {
      this.http.get<{ status: string; access_token?: string; id?: number; nome?: string; turno?: string; id_condominio?: number; condominio_nome?: string }>(`/api/auth/qr/status/${token}`).subscribe({
        next: (res) => {
          if (res.status === 'confirmed' && res.access_token) {
            this.clearPolling();
            this.auth.loginComToken({
              access_token: res.access_token,
              id: res.id,
              nome: res.nome || 'Usuário Conectado',
              turno: res.turno || 'Turno QR',
              id_condominio: res.id_condominio || 1,
              condominio_nome: res.condominio_nome
            });
            this.router.navigate(['/']);
          } else if (res.status === 'expired') {
            this.clearPolling();
            this.qrExpired.set(true);
          }
        },
        error: () => {
          this.clearPolling();
          this.qrExpired.set(true);
        }
      });
    }, 1500);
  }

  private clearPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }
}