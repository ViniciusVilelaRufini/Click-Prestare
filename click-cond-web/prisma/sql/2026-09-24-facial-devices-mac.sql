-- Etapa 3 do agente (descoberta na rede): identidade física do aparelho, para
-- reencontrá-lo quando o roteador troca o IP por DHCP. O MAC é o que não muda;
-- o número de série fica guardado para o operador conferir na etiqueta.
--
-- Um ALTER por coluna/índice de propósito: o runner (scripts/run-sql-migration.mjs)
-- aplica comando a comando e trata ER_DUP_FIELDNAME / ER_DUP_KEYNAME como
-- "já existe". Assim o arquivo é idempotente mesmo se alguém já tiver aplicado
-- parte dele à mão (o antigo prisma/manual_2026-09_facial_devices_mac.sql).

ALTER TABLE `Facial_Devices` ADD COLUMN `mac` VARCHAR(17) NULL AFTER `porta`;
ALTER TABLE `Facial_Devices` ADD COLUMN `numero_serie` VARCHAR(64) NULL AFTER `mac`;
ALTER TABLE `Facial_Devices` ADD INDEX `idx_facdev_mac` (`mac`);
