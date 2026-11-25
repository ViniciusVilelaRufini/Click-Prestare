import {
  Directive,
  ElementRef,
  HostListener,
  Input,
  OnInit,
  forwardRef,
  inject,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export type MaskType = 'cpf' | 'cnpj' | 'cpfCnpj' | 'phone' | 'cep' | 'date';

/**
 * Diretiva de máscara para inputs de texto. Aplica formatação ao digitar e
 * mantém o valor formatado tanto no DOM quanto no FormControl/ngModel.
 *
 * Uso: `<input type="text" appMask="cpf" [(ngModel)]="cpf" />`
 *
 * - cpf:     000.000.000-00
 * - cnpj:    00.000.000/0000-00
 * - cpfCnpj: alterna entre CPF e CNPJ pelo tamanho
 * - phone:   (00) 0000-0000  ou  (00) 90000-0000
 * - cep:     00000-000
 * - date:    00/00/0000
 */
@Directive({
  selector: '[appMask]',
  standalone: true,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputMaskDirective),
      multi: true,
    },
  ],
})
export class InputMaskDirective implements ControlValueAccessor, OnInit {
  @Input('appMask') mask: MaskType = 'cpf';

  private el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnInit() {
    // Formata valor inicial, se já vier preenchido (ex.: edição).
    const initial = this.el.nativeElement.value;
    if (initial) {
      this.el.nativeElement.value = this.format(initial);
    }
  }

  @HostListener('input', ['$event'])
  onInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const value = input.value;
    const formatted = this.format(value);
    if (formatted !== value) {
      input.value = formatted;
    }
    this.onChange(formatted);
  }

  @HostListener('blur')
  onBlur() {
    this.onTouched();
  }

  writeValue(value: any): void {
    const v = value == null ? '' : String(value);
    this.el.nativeElement.value = v ? this.format(v) : '';
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.el.nativeElement.disabled = isDisabled;
  }

  private format(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    switch (this.mask) {
      case 'cpf':
        return this.formatCpf(digits);
      case 'cnpj':
        return this.formatCnpj(digits);
      case 'cpfCnpj':
        return digits.length <= 11 ? this.formatCpf(digits) : this.formatCnpj(digits);
      case 'phone':
        return this.formatPhone(digits);
      case 'cep':
        return this.formatCep(digits);
      case 'date':
        return this.formatDate(digits);
      default:
        return raw;
    }
  }

  private formatCpf(d: string): string {
    d = d.slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  private formatCnpj(d: string): string {
    d = d.slice(0, 14);
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
    if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
    if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }

  private formatPhone(d: string): string {
    d = d.slice(0, 11);
    if (d.length === 0) return '';
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) {
      // Fixo: (00) 0000-0000
      return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    }
    // Celular: (00) 90000-0000
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  private formatCep(d: string): string {
    d = d.slice(0, 8);
    if (d.length <= 5) return d;
    return `${d.slice(0, 5)}-${d.slice(5)}`;
  }

  private formatDate(d: string): string {
    d = d.slice(0, 8);
    if (d.length <= 2) return d;
    if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
    return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  }
}

/**
 * Telefone para EXIBIÇÃO (listas, fichas): o cadastro antigo/importado guarda
 * "11953561869" cru e o novo, "(17) 98833-8146" (máscara `phone`). Com 10 ou 11
 * dígitos (e só dígitos, espaços, parênteses, hífen ou ponto) sai no mesmo
 * formato da máscara; qualquer outro formato (ex.: "+55 …") sai como veio.
 */
export function formatarTelefoneExibicao(valor: string | null | undefined): string {
  if (valor == null) return '';
  const bruto = String(valor).trim();
  if (!/^[\d\s().-]+$/.test(bruto)) return bruto;
  const d = bruto.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return bruto;
}

/**
 * Helpers — utilitários de validação básicos (usar nos componentes antes de salvar).
 */
export const validators = {
  isEmail(value: string | null | undefined): boolean {
    if (!value) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  },
  isCpf(value: string | null | undefined): boolean {
    if (!value) return false;
    const d = value.replace(/\D/g, '');
    return d.length === 11 && !/^(\d)\1+$/.test(d);
  },
  isCnpj(value: string | null | undefined): boolean {
    if (!value) return false;
    const d = value.replace(/\D/g, '');
    return d.length === 14 && !/^(\d)\1+$/.test(d);
  },
  isPhone(value: string | null | undefined): boolean {
    if (!value) return false;
    const d = value.replace(/\D/g, '');
    return d.length === 10 || d.length === 11;
  },
};
