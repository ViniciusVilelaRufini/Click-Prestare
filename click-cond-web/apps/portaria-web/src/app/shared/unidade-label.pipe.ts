import { Pipe, PipeTransform } from '@angular/core';
import { rotuloUnidade } from './bloco-label.util';

/** `{{ a.apto | unidade: a.bloco }}` → "Bloco A · Apto 101". */
@Pipe({ name: 'unidade', standalone: true })
export class UnidadeLabelPipe implements PipeTransform {
  transform(apto: string | number | null | undefined, bloco?: string | null): string {
    return rotuloUnidade(bloco, apto);
  }
}
