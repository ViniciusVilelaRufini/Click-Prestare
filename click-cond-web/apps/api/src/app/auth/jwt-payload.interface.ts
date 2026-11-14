export interface JwtPayload {
  sub: number;
  nome: string;
  email?: string;
  id_condominio?: number;
  turno?: string | null;
  typeAccess?: string;
  /** Marca tokens administrativos do CRM ('crm_admin'). Ausente em tokens de porteiro/app. */
  role?: string;
  /**
   * Namespace do `sub` quando ele NÃO é Users.id. Só o login do console por Funcionarios_Portaria
   * carimba 'funcionario_portaria'; nenhum cliente escolhe (vem assinado). Quem precisa saber de
   * que tabela é o `sub` lê isto, nunca a forma do token.
   */
  tipo_sub?: 'funcionario_portaria';
  /**
   * Token do porteiro do console: carimbo da credencial (login + senha) com que ele entrou
   * (credencial-portaria.util). O JwtStrategy recusa o token quando a credencial da linha mudou.
   */
  cred?: string;
  user?: any;
}