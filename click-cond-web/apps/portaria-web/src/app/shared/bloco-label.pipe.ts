import { Pipe, PipeTransform } from '@angular/core';
import { rotuloBloco } from './bloco-label.util';

/** `{{ x.bloco | blocoLabel }}` → "Bloco A" (sem duplicar quando já vem "Bloco A"). */
@Pipe({
  name: 'blocoLabel',
  standalone: true,
})
export class BlocoLabelPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return rotuloBloco(value);
  }
}
