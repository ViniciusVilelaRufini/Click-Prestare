import { CreateEncomenda } from './encomendas.service';
import { Apartamento } from '../apartamentos/apartamentos.service';

export interface LeituraEtiqueta {
  leitura: {
    nome: string | null;
    apto: string | null;
    bloco: string | null;
    transportadora: string | null;
    codigo_rastreio: string | null;
    descricao: string | null;
  };
  destinatario: { apto: string; bloco: string | null; nome: string } | null;
}

/** Reduz a foto (lado maior = ladoMax) e devolve um data URL JPEG. */
export function reduzirImagem(file: File, ladoMax = 1280, qualidade = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const escala = Math.min(1, ladoMax / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas indisponível');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', qualidade));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('imagem inválida'));
    };
    img.src = url;
  });
}

/** Aplica a leitura da etiqueta ao formulário sem sobrescrever o que o porteiro já preencheu. */
export function aplicarLeitura(
  novo: CreateEncomenda,
  selecionado: Apartamento | null,
  apartamentos: Apartamento[],
  r: LeituraEtiqueta,
): { novo: CreateEncomenda; selecionado: Apartamento | null; preencheu: boolean } {
  const out: CreateEncomenda = { ...novo };
  let sel = selecionado;
  let preencheu = false;
  const l = r.leitura ?? ({} as LeituraEtiqueta['leitura']);

  const preenche = (campo: 'recebido_de' | 'codigo_rastreio' | 'descricao', valor: string | null | undefined) => {
    if (valor && !out[campo]?.trim()) {
      out[campo] = valor;
      preencheu = true;
    }
  };
  preenche('recebido_de', l.transportadora);
  preenche('codigo_rastreio', l.codigo_rastreio);
  preenche('descricao', l.descricao);

  if (!sel && r.destinatario) {
    const d = r.destinatario;
    const achado = apartamentos.find(
      (a) => String(a.apto) === String(d.apto) && (a.bloco ?? '') === (d.bloco ?? ''),
    );
    if (achado) {
      sel = achado;
      preencheu = true;
    }
  }
  return { novo: out, selecionado: sel, preencheu };
}
