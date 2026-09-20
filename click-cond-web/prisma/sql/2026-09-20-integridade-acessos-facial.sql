-- Integridade do log de acesso físico.
-- Aplicar SOMENTE depois do wipe: a FK de id_device falha enquanto existirem
-- eventos apontando para dispositivo inexistente (eram 185 em 19/09/2026).

-- D1 — snapshot do aparelho na própria linha do evento, para o log continuar
-- legível se o dispositivo for removido depois. Mesmo padrão de nome_pessoa.
ALTER TABLE `Acessos_Facial`
  ADD COLUMN `nome_dispositivo` VARCHAR(100) NULL AFTER `tipo_dispositivo`;

-- D3 — o histórico deixa de ser destruído junto com o condomínio.
-- Remover um condomínio passa a exigir expurgo explícito do log antes.
ALTER TABLE `Acessos_Facial` DROP FOREIGN KEY `fk_acfac_cond`;
ALTER TABLE `Acessos_Facial`
  ADD CONSTRAINT `fk_acfac_cond` FOREIGN KEY (`id_condominio`)
  REFERENCES `Condominios` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- D2 — id_device deixa de ser um inteiro solto.
-- RESTRICT: apagar um terminal não pode apagar o histórico de quem passou por ele.
CREATE INDEX `idx_acfac_device` ON `Acessos_Facial` (`id_device`);
ALTER TABLE `Acessos_Facial`
  ADD CONSTRAINT `fk_acfac_device` FOREIGN KEY (`id_device`)
  REFERENCES `Facial_Devices` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
