import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SlideIndicatorDirective } from '../shared/slide-indicator.directive';
import {
  GuaritaCapturado,
  GuaritaDevice,
  GuaritaService,
  ROTULO_TIPO_GUARITA,
  capturadoBloqueado,
  mensagemDaApiGuarita,
} from './guarita.service';

/** Duração da janela de captura (a API guarda a janela; aqui é só a contagem na tela). */
export const JANELA_CAPTURA_S = 60;
/** De quanto em quanto tempo a tela pergunta o que chegou na janela. */
const LER_CAPTURA_A_CADA_S = 2;

export const ORIENTACAO_CAPTURA =
  'Peça ao porteiro para entrar em Menu > Cadastro Rápido no Guarita e acione o controle';

/** Veículo a que o dispositivo capturado/digitado será ligado. */
export interface VeiculoDaCaptura {
  id: number;
  placa: string;
  morador?: { nome: string } | null;
}

/**
 * "Cadastrar controle/tag" de um veículo num condomínio com Módulo Guarita:
 * por aproximação (janela de 60 s ouvindo os avisos de "não cadastrado") ou
 * pelo código impresso na TAG/cartão. Controle remoto só por aproximação.
 */
@Component({
  selector: 'app-guarita-captura',
  standalone: true,
  imports: [CommonModule, FormsModule, SlideIndicatorDirective],
  templateUrl: './guarita-captura.component.html',
})
export class GuaritaCapturaComponent implements OnInit, OnDestroy {
  @Input({ required: true }) veiculo!: VeiculoDaCaptura;
  @Input({ required: true }) guaritas: GuaritaDevice[] = [];
  @Output() fechar = new EventEmitter<void>();
  /** Cadastro enfileirado na API: a tela de Veículos recarrega. */
  @Output() cadastrado = new EventEmitter<void>();

  private api = inject(GuaritaService);

  readonly orientacao = ORIENTACAO_CAPTURA;
  readonly rotuloTipo = ROTULO_TIPO_GUARITA;
  readonly tiposPorCodigo: (2 | 3 | 6)[] = [2, 3, 6];
  readonly bloqueado = capturadoBloqueado;

  deviceId: number | null = null;
  readonly modo = signal<'aproximacao' | 'codigo'>('aproximacao');

  readonly segundos = signal(0);
  readonly janelaAberta = signal(false);
  /** A janela já foi aberta pelo menos uma vez (para "Capturar de novo"). */
  readonly janelaUsada = signal(false);
  readonly abrindo = signal(false);
  readonly recebidos = signal<GuaritaCapturado[]>([]);
  readonly enviando = signal(false);
  readonly erro = signal<string | null>(null);

  codigoTipo: 2 | 3 | 6 = 2;
  codigoImpresso = '';

  private relogio?: ReturnType<typeof setInterval>;
  private destruido = false;

  ngOnInit(): void {
    this.deviceId = this.guaritas[0]?.id ?? null;
    // Um Guarita só: a contagem já começa ao abrir.
    if (this.guaritas.length === 1) this.iniciarCaptura();
  }

  ngOnDestroy(): void {
    this.destruido = true;
    this.pararRelogio();
  }

  trocarModo(m: 'aproximacao' | 'codigo') {
    this.modo.set(m);
    this.erro.set(null);
  }

  iniciarCaptura() {
    const deviceId = this.deviceId;
    if (deviceId == null || this.abrindo() || this.janelaAberta()) return;
    this.abrindo.set(true);
    this.erro.set(null);
    this.recebidos.set([]);
    this.api.abrirCaptura(deviceId, this.veiculo.id).subscribe({
      next: () => {
        if (this.destruido) return;
        this.abrindo.set(false);
        this.janelaAberta.set(true);
        this.janelaUsada.set(true);
        this.segundos.set(JANELA_CAPTURA_S);
        this.pararRelogio();
        this.relogio = setInterval(() => this.tique(deviceId), 1000);
      },
      error: (err) => {
        if (this.destruido) return;
        this.abrindo.set(false);
        this.erro.set(mensagemDaApiGuarita(err, 'Não foi possível abrir a captura.'));
      },
    });
  }

  private tique(deviceId: number) {
    const restante = this.segundos() - 1;
    this.segundos.set(Math.max(0, restante));
    if (restante <= 0) {
      this.pararRelogio();
      this.janelaAberta.set(false);
      this.ler(deviceId); // última leitura: o que chegou no fim da janela
      return;
    }
    if ((JANELA_CAPTURA_S - restante) % LER_CAPTURA_A_CADA_S === 0) this.ler(deviceId);
  }

  private ler(deviceId: number) {
    this.api.lerCaptura(deviceId).subscribe({
      next: (lista) => {
        if (this.destruido) return;
        this.recebidos.set(lista);
      },
      // Falha de uma leitura não apaga o que já chegou; a próxima tenta de novo.
      error: () => {},
    });
  }

  private pararRelogio() {
    if (this.relogio) clearInterval(this.relogio);
    this.relogio = undefined;
  }

  usar(c: GuaritaCapturado) {
    const deviceId = this.deviceId;
    if (deviceId == null || this.enviando() || capturadoBloqueado(c)) return;
    this.enviando.set(true);
    this.erro.set(null);
    this.api
      .confirmarCaptura(deviceId, { tipo: Number(c.tipo), serial_hex: c.serial_hex, id_veiculo: this.veiculo.id })
      .subscribe({
        next: () => {
          if (this.destruido) return;
          this.enviando.set(false);
          this.pararRelogio();
          this.cadastrado.emit();
        },
        error: (err) => {
          if (this.destruido) return;
          this.enviando.set(false);
          this.erro.set(mensagemDaApiGuarita(err, 'Não foi possível cadastrar o dispositivo.'));
        },
      });
  }

  cadastrarPorCodigo() {
    const deviceId = this.deviceId;
    if (deviceId == null || this.enviando()) return;
    const codigo = this.codigoImpresso.trim();
    if (!codigo) {
      this.erro.set('Informe o código impresso na TAG ou no cartão.');
      return;
    }
    this.enviando.set(true);
    this.erro.set(null);
    this.api
      .cadastrarPorCodigo(deviceId, { id_veiculo: this.veiculo.id, tipo: Number(this.codigoTipo) as 2 | 3 | 6, codigo_impresso: codigo })
      .subscribe({
        next: () => {
          if (this.destruido) return;
          this.enviando.set(false);
          this.pararRelogio();
          this.cadastrado.emit();
        },
        error: (err) => {
          if (this.destruido) return;
          this.enviando.set(false);
          this.erro.set(mensagemDaApiGuarita(err, 'Não foi possível cadastrar o dispositivo.'));
        },
      });
  }

  trocarGuarita(id: number) {
    if (this.janelaAberta()) return;
    this.deviceId = Number(id);
    this.recebidos.set([]);
    this.janelaUsada.set(false);
  }
}
