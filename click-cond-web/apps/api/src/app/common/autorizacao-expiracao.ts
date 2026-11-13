/**
 * Prazo único do pedido de autorização ao morador (portaria remota): depois
 * dele o pedido vence, o morador não consegue mais autorizar e a autorização
 * dada deixa de valer para uma visita ainda não usada. Usado pela API de
 * visitantes e pelo card ao vivo — nada de cópias numéricas.
 */
export const AUTORIZACAO_EXPIRACAO_MS = 10 * 60 * 1000;
