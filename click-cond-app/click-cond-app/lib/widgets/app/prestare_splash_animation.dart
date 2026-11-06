import 'dart:math' as math;

import 'package:click/widgets/app/prestare_splash_paths.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

/// Tela de abertura animada, recriação fiel de `prestare-splash-demo.html`.
///
/// O desenho inteiro é função pura do tempo decorrido em segundos: um único
/// [Ticker] alimenta o painter, e cada elemento calcula o próprio estado a
/// partir dos mesmos atrasos, durações e curvas do CSS. Os ciclos infinitos têm
/// períodos diferentes (3,2s, 4,1s, 2,7s, 3,6s, 2,4s e 1,6s), e um relógio único
/// evita a deriva e a coleção de controllers que cada um deles exigiria.
class PrestareSplashAnimation extends StatefulWidget {
  const PrestareSplashAnimation({super.key, this.aoPassarTempo});

  /// Chamado a cada frame com o tempo desde o primeiro frame.
  final ValueChanged<Duration>? aoPassarTempo;

  @override
  State<PrestareSplashAnimation> createState() =>
      _PrestareSplashAnimationState();
}

class _PrestareSplashAnimationState extends State<PrestareSplashAnimation>
    with SingleTickerProviderStateMixin {
  final ValueNotifier<double> _tempo = ValueNotifier<double>(0);
  late final Ticker _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = createTicker(_tique)..start();
  }

  void _tique(Duration decorrido) {
    _tempo.value = decorrido.inMicroseconds / Duration.microsecondsPerSecond;
    widget.aoPassarTempo?.call(decorrido);
  }

  @override
  void dispose() {
    _ticker.dispose();
    _tempo.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final estatico = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    return ColoredBox(
      color: const Color(0xFF000000),
      child: Center(
        child: LayoutBuilder(
          builder: (context, restricoes) {
            final largura = math.min(160.0, restricoes.maxWidth * 0.4);
            return Semantics(
              image: true,
              label: 'Prestare carregando',
              textDirection: TextDirection.ltr,
              child: RepaintBoundary(
                child: CustomPaint(
                  size: Size(
                    largura,
                    largura * _viewBox.height / _viewBox.width,
                  ),
                  painter: PrestareSplashPainter(
                    tempo: _tempo,
                    estatico: estatico,
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

/// Mantém a [PrestareSplashAnimation] sobre o app até ele estar pronto E o
/// tempo mínimo passar; depois some num fade e sai da árvore.
///
/// O app real vai numa única instância, montada por [builder] assim que
/// [appPronto] vira true e sem esperar a animação: deep link, push e auto-login
/// seguem por baixo. Como é a mesma posição (com chave) durante toda a vida,
/// o fim da abertura não remonta o `MaterialApp` nem repete `HomePage._init`.
class PrestareSplashGate extends StatefulWidget {
  const PrestareSplashGate({
    super.key,
    required this.appPronto,
    required this.builder,
    this.tempoMinimo = const Duration(milliseconds: 2400),
    this.duracaoFade = const Duration(milliseconds: 300),
  });

  final bool appPronto;
  final WidgetBuilder builder;
  final Duration tempoMinimo;
  final Duration duracaoFade;

  @override
  State<PrestareSplashGate> createState() => _PrestareSplashGateState();
}

class _PrestareSplashGateState extends State<PrestareSplashGate>
    with SingleTickerProviderStateMixin {
  static const _chaveApp = ValueKey<String>('app');
  static const _chaveAbertura = ValueKey<String>('abertura');

  late final AnimationController _fade;
  late final Animation<double> _opacidade;
  bool _minimoCumprido = false;
  bool _encerrada = false;

  @override
  void initState() {
    super.initState();
    _fade = AnimationController(vsync: this, duration: widget.duracaoFade);
    _fade.addStatusListener(_mudouFade);
    _opacidade = ReverseAnimation(_fade);
  }

  void _mudouFade(AnimationStatus status) {
    if (status.isCompleted && mounted) setState(() => _encerrada = true);
  }

  // O mínimo é medido nos frames da animação, não num Timer: se o processo sobe
  // em segundo plano, a abertura não é consumida sem ninguém ver.
  void _passouTempo(Duration decorrido) {
    if (_minimoCumprido || decorrido < widget.tempoMinimo) return;
    _minimoCumprido = true;
    _talvezEncerrar();
  }

  void _talvezEncerrar() {
    if (_minimoCumprido && widget.appPronto && _fade.isDismissed) {
      _fade.forward();
    }
  }

  @override
  void didUpdateWidget(PrestareSplashGate oldWidget) {
    super.didUpdateWidget(oldWidget);
    _talvezEncerrar();
  }

  @override
  void dispose() {
    _fade.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Fica acima de qualquer MaterialApp: não há Directionality nem MediaQuery
    // aqui, daí o textDirection explícito e o MediaQuery próprio da abertura.
    return Stack(
      alignment: Alignment.topLeft,
      textDirection: TextDirection.ltr,
      fit: StackFit.expand,
      children: [
        if (widget.appPronto)
          KeyedSubtree(
            key: _chaveApp,
            child: ExcludeSemantics(
              excluding: !_encerrada,
              child: widget.builder(context),
            ),
          ),
        if (!_encerrada)
          KeyedSubtree(
            key: _chaveAbertura,
            child: MediaQuery.fromView(
              view: View.of(context),
              child: AbsorbPointer(
                child: FadeTransition(
                  opacity: _opacidade,
                  child: PrestareSplashAnimation(aoPassarTempo: _passouTempo),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Desenha o SVG de referência no instante [tempo], em segundos.
class PrestareSplashPainter extends CustomPainter {
  PrestareSplashPainter({required this.tempo, this.estatico = false})
      : super(repaint: estatico ? null : tempo);

  final ValueListenable<double> tempo;

  /// Estado final do `prefers-reduced-motion` da demo: prédios, janelas, cursor
  /// e nome inteiros, trilho da barra vazio, sem ripple nem progresso.
  final bool estatico;

  @override
  void paint(Canvas canvas, Size size) {
    final t = tempo.value;
    final escala = size.width / _viewBox.width;

    canvas.save();
    // O <svg> externo recorta no viewport: o cursor entra de +14,+14 e a ponta
    // passa de x=88 por alguns frames.
    canvas.clipRect(Offset.zero & size);
    canvas.scale(escala);
    canvas.translate(-_viewBox.left, -_viewBox.top);

    // Máscara `mbd`: o prédio de trás perde a folga do da frente e a do cursor.
    canvas.saveLayer(_viewBox, Paint());
    _desenharPredio(canvas, _predioTras, _progressoPredio(t, 0));
    for (final janela in _janelasTras) {
      _desenharJanela(canvas, janela, t);
    }
    canvas.drawPath(_haloFrente, _recorte);
    canvas.drawPath(_haloCursor, _recorte);
    canvas.restore();

    // Máscara `mfd`: o prédio da frente perde só a folga do cursor.
    canvas.saveLayer(_viewBox, Paint());
    _desenharPredio(canvas, _predioFrente, _progressoPredio(t, 0.18));
    for (final janela in _janelasFrente) {
      _desenharJanela(canvas, janela, t);
    }
    canvas.drawPath(_haloCursor, _recorte);
    canvas.restore();

    if (!estatico) {
      _desenharRipples(canvas, t);
    }
    _desenharCursor(canvas, t);
    _desenharNome(canvas, t);
    canvas.drawRRect(
        _rrectBarra, Paint()..color = _branco.withValues(alpha: .16));
    if (!estatico) {
      _desenharProgresso(canvas, t);
    }
    canvas.restore();
  }

  /// Fração visível do contorno. A demo usa `pathLength=1` com dash de 1.02 e
  /// offset de 1.02 a 0, então a ponta anda 1.02 e fecha antes do fim da curva.
  double _progressoPredio(double t, double atraso) {
    if (estatico) return 1;
    return _noIntervalo(t, atraso, 0.9, _curvaTraco) * 1.02;
  }

  void _desenharPredio(Canvas canvas, Path contorno, double fracao) {
    if (fracao <= 0) return;
    final Path visivel;
    if (fracao >= 1) {
      visivel = contorno;
    } else {
      final medida = contorno.computeMetrics().first;
      visivel = medida.extractPath(0, medida.length * fracao);
    }
    canvas.drawPath(
      visivel,
      Paint()
        ..color = _branco
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4.4
        ..strokeCap = StrokeCap.round,
    );
  }

  void _desenharJanela(Canvas canvas, _Janela janela, double t) {
    var opacidade = 1.0;
    var escala = 1.0;
    if (!estatico) {
      // pllit: 0% {0, .4} 60% {1, 1.15} 100% {1, 1}.
      final p = (t - janela.atraso) / 0.35;
      if (p <= 0) return;
      if (p < 0.6) {
        final e = _curvaPop.transform(p / 0.6);
        opacidade = e;
        escala = _lerp(0.4, 1.15, e);
      } else if (p < 1) {
        escala = _lerp(1.15, 1, _curvaPop.transform((p - 0.6) / 0.4));
      }
      // pltwinkle vem depois na lista de animações e manda na opacidade.
      if (janela.ciclo != null && t >= janela.atrasoCiclo!) {
        opacidade = _piscada(_fase(t, janela.atrasoCiclo!, janela.ciclo!));
      }
    }
    if (opacidade <= 0) return;

    final centro = Offset(
      janela.x + _ladoJanela / 2,
      janela.y + _ladoJanela / 2,
    );
    canvas.save();
    canvas.translate(centro.dx, centro.dy);
    canvas.scale(escala);
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(
          center: Offset.zero,
          width: _ladoJanela,
          height: _ladoJanela,
        ),
        const Radius.circular(1.1),
      ),
      Paint()..color = _ambar.withValues(alpha: opacidade),
    );
    canvas.restore();
  }

  void _desenharRipples(Canvas canvas, double t) {
    // plripple0: passa uma vez, .9s a partir de 1,55s.
    final p0 = (t - 1.55) / 0.9;
    if (p0 > 0 && p0 < 1) {
      final e = _curvaSaida.transform(p0);
      _desenharRipple(canvas, _lerp(0.9, 0, e), _lerp(0.2, 1.8, e));
    }

    // plripple: a transformação só tem chaves em 84% e 100%, então a curva vale
    // para o trecho inteiro; a opacidade ainda tem a chave de 88%.
    if (t < 2.25) return;
    final f = _fase(t, 2.25, 2.4);
    if (f <= 0.84) return;
    final escala = _lerp(0.2, 1.8, _curvaSaida.transform((f - 0.84) / 0.16));
    final opacidade = f < 0.88
        ? _lerp(0, 0.9, _curvaSaida.transform((f - 0.84) / 0.04))
        : _lerp(0.9, 0, _curvaSaida.transform((f - 0.88) / 0.12));
    _desenharRipple(canvas, opacidade, escala);
  }

  void _desenharRipple(Canvas canvas, double opacidade, double escala) {
    if (opacidade <= 0) return;
    canvas.save();
    canvas.translate(52, 66);
    canvas.scale(escala);
    canvas.drawCircle(
      Offset.zero,
      7,
      Paint()
        ..color = _branco.withValues(alpha: opacidade)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2,
    );
    canvas.restore();
  }

  void _desenharCursor(Canvas canvas, double t) {
    var opacidade = 1.0;
    var deslocamento = 0.0;
    var escala = 1.0;
    if (!estatico) {
      // plcurIn: o `px` de um transform dentro de SVG é unidade do viewBox.
      if (t <= 1.05) return;
      final e = _noIntervalo(t, 1.05, 0.6, _curvaPop);
      opacidade = e;
      deslocamento = 14 * (1 - e);
      // plclick assume a transformação a partir de 2,2s.
      if (t >= 2.2) {
        final f = _fase(t, 2.2, 2.4);
        if (f > 0.82 && f < 0.88) {
          escala = _lerp(1, 0.86, _curvaCiclo.transform((f - 0.82) / 0.06));
        } else if (f >= 0.88) {
          escala = _lerp(0.86, 1, _curvaCiclo.transform((f - 0.88) / 0.12));
        }
      }
    }
    if (opacidade <= 0) return;

    canvas.save();
    canvas.translate(deslocamento, deslocamento);
    // transform-origin 0 0 do fill-box: canto da caixa do path.
    canvas.translate(_origemCursor.dx, _origemCursor.dy);
    canvas.scale(escala);
    canvas.translate(-_origemCursor.dx, -_origemCursor.dy);
    canvas.drawPath(
        _cursor, Paint()..color = _branco.withValues(alpha: opacidade));
    canvas.restore();
  }

  void _desenharNome(Canvas canvas, double t) {
    var opacidade = 1.0;
    var deslocamento = 0.0;
    if (!estatico) {
      final e = _noIntervalo(t, 1.35, 0.8, _curvaPop);
      if (t <= 1.35 || e <= 0) return;
      opacidade = e;
      deslocamento = 4 * (1 - e);
    }
    canvas.save();
    canvas.translate(0, deslocamento);
    canvas.drawPath(
        _nome, Paint()..color = _branco.withValues(alpha: opacidade));
    canvas.restore();
  }

  void _desenharProgresso(Canvas canvas, double t) {
    if (t < 1.6) return;
    // plprog: translateX em % da caixa (32 de largura), scaleX a partir do canto.
    final f = _fase(t, 1.6, 1.6);
    final double dx;
    final double escalaX;
    if (f < 0.5) {
      final e = _curvaTraco.transform(f / 0.5);
      dx = _lerp(0, 0.3, e) * _rectBarra.width;
      escalaX = _lerp(0.05, 0.55, e);
    } else {
      final e = _curvaTraco.transform((f - 0.5) / 0.5);
      dx = _lerp(0.3, 1, e) * _rectBarra.width;
      escalaX = _lerp(0.55, 0.05, e);
    }
    canvas.save();
    canvas.translate(_rectBarra.left + dx, 0);
    canvas.scale(escalaX, 1);
    canvas.translate(-_rectBarra.left, 0);
    canvas.drawRRect(_rrectBarra, Paint()..color = _branco);
    canvas.restore();
  }

  @override
  bool shouldRepaint(PrestareSplashPainter oldDelegate) =>
      oldDelegate.tempo != tempo || oldDelegate.estatico != estatico;
}

/// Converte `d` de SVG em [Path], com os comandos absolutos que a arte usa
/// (M, L, H, V, Q, Z), inclusive coordenadas repetidas sem letra.
@visibleForTesting
Path parseSvgPath(String dados) {
  final tokens = RegExp(
    r'[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?',
  ).allMatches(dados).map((m) => m.group(0)!).toList();
  final path = Path();
  var i = 0;
  var comando = '';
  var x = 0.0;
  var y = 0.0;
  var inicioX = 0.0;
  var inicioY = 0.0;
  double numero() => double.parse(tokens[i++]);

  while (i < tokens.length) {
    if (RegExp(r'^[A-Za-z]$').hasMatch(tokens[i])) comando = tokens[i++];
    switch (comando) {
      case 'M':
        x = inicioX = numero();
        y = inicioY = numero();
        path.moveTo(x, y);
        comando = 'L'; // pares seguintes ao M são L implícitos
      case 'L':
        x = numero();
        y = numero();
        path.lineTo(x, y);
      case 'H':
        x = numero();
        path.lineTo(x, y);
      case 'V':
        y = numero();
        path.lineTo(x, y);
      case 'Q':
        final cx = numero();
        final cy = numero();
        x = numero();
        y = numero();
        path.quadraticBezierTo(cx, cy, x, y);
      case 'Z':
        path.close();
        x = inicioX;
        y = inicioY;
      default:
        throw FormatException('Comando de path não suportado: $comando');
    }
  }
  return path;
}

double _lerp(double a, double b, double t) => a + (b - a) * t;

/// Progresso já com curva de uma animação com atraso e `forwards`.
double _noIntervalo(double t, double atraso, double duracao, Curve curva) {
  return curva.transform(((t - atraso) / duracao).clamp(0.0, 1.0));
}

/// Posição (0 a 1) dentro de um ciclo infinito.
double _fase(double t, double atraso, double periodo) {
  return ((t - atraso) % periodo) / periodo;
}

/// pltwinkle: 0%, 45%, 55%, 100% em 1 e 50% em .25, com curva por trecho.
double _piscada(double f) {
  if (f <= 0.45 || f >= 0.55) return 1;
  return f < 0.5
      ? _lerp(1, 0.25, _curvaCiclo.transform((f - 0.45) / 0.05))
      : _lerp(0.25, 1, _curvaCiclo.transform((f - 0.5) / 0.05));
}

/// Contorno de `<rect rx>` na ordem do SVG: sai de (x+rx, y) em sentido horário.
/// O dash do traço anda nessa ordem, então não dá para usar `addRRect`.
Path _contornoRect(double x, double y, double l, double a, double r) {
  final raio = Radius.circular(r);
  return Path()
    ..moveTo(x + r, y)
    ..lineTo(x + l - r, y)
    ..arcToPoint(Offset(x + l, y + r), radius: raio)
    ..lineTo(x + l, y + a - r)
    ..arcToPoint(Offset(x + l - r, y + a), radius: raio)
    ..lineTo(x + r, y + a)
    ..arcToPoint(Offset(x, y + a - r), radius: raio)
    ..lineTo(x, y + r)
    ..arcToPoint(Offset(x + r, y), radius: raio)
    ..close();
}

class _Janela {
  const _Janela(this.x, this.y, this.atraso, [this.ciclo, this.atrasoCiclo]);

  final double x;
  final double y;
  final double atraso;
  final double? ciclo;
  final double? atrasoCiclo;
}

const Rect _viewBox = Rect.fromLTWH(4, -2, 84, 136);
const double _ladoJanela = 5.2;
const Color _branco = Color(0xFFFFFFFF);
const Color _ambar = Color(0xFFFFC83D);
const Offset _origemCursor = Offset(51.20, 65.20);
const Rect _rectBarra = Rect.fromLTWH(30, 126, 32, 1.2);
final RRect _rrectBarra = RRect.fromRectXY(_rectBarra, 0.6, 0.6);

const Cubic _curvaTraco = Cubic(.65, 0, .35, 1);
const Cubic _curvaPop = Cubic(.2, .8, .2, 1);
const Cubic _curvaCiclo = Cubic(.42, 0, .58, 1); // ease-in-out do CSS
const Cubic _curvaSaida = Cubic(0, 0, .58, 1); // ease-out do CSS

final Paint _recorte = Paint()..blendMode = BlendMode.dstOut;

final Path _predioTras = _contornoRect(36, 6, 32, 58, 5);
final Path _predioFrente = _contornoRect(16, 30, 30, 48, 5);
final Path _haloFrente = parseSvgPath(kSplashHaloPredioFrente);
final Path _haloCursor = parseSvgPath(kSplashHaloCursor);
final Path _cursor = parseSvgPath(kSplashCursor);
final Path _nome = parseSvgPath(kSplashNome);

const double _ciclo0 = 3.2;
const double _ciclo1 = 4.1;
const double _ciclo2 = 2.7;
const double _ciclo3 = 3.6;

const List<_Janela> _janelasTras = [
  _Janela(41.3, 13, 1.02, _ciclo0, 2.4),
  _Janela(49.4, 13, 1.33),
  _Janela(57.5, 13, 1.16),
  _Janela(49.4, 21.5, 0.97, _ciclo3, 3.51),
  _Janela(57.5, 21.5, 1.38),
  _Janela(57.5, 30, 0.80),
  _Janela(57.5, 38.5, 1.25, _ciclo2, 4.62),
  _Janela(57.5, 47, 1.42),
];

const List<_Janela> _janelasFrente = [
  _Janela(23.4, 38, 1.06),
  _Janela(33.4, 38, 0.89, _ciclo1, 5.73),
  _Janela(23.4, 46.5, 0.75),
  _Janela(33.4, 46.5, 1.29),
  _Janela(23.4, 55, 0.84, _ciclo0, 6.84),
  _Janela(33.4, 55, 1.11),
  _Janela(23.4, 63.5, 0.93),
  _Janela(33.4, 63.5, 1.20, _ciclo3, 7.95),
];
