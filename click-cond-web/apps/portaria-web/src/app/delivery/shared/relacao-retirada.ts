/** Mesmos códigos/rótulos da retirada de Encomendas (select "Relação/Vínculo"). */
export const RELACOES_RETIRADA: readonly { codigo: string; rotulo: string }[] = [
  { codigo: 'Morador', rotulo: 'Morador (Próprio destinatário)' },
  { codigo: 'Familiar', rotulo: 'Familiar (Cônjuge, Filho, etc.)' },
  { codigo: 'Autorizado', rotulo: 'Pessoa Autorizada' },
  { codigo: 'Funcionario', rotulo: 'Funcionário do morador' },
  { codigo: 'Outro', rotulo: 'Outro' },
];
