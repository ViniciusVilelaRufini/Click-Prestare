export interface JwtPayload {
  sub: number;
  nome: string;
  id_condominio?: number;
  turno?: string | null;
  typeAccess?: string;
  /** Marca tokens administrativos do CRM ('crm_admin'). Ausente em tokens de porteiro/app. */
  role?: string;
  user?: any;
}