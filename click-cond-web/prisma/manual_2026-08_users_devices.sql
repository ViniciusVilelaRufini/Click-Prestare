-- Aparelhos por usuário (push multi-device)
--
-- Users.fcm_token guarda UM token por usuário, e o registro ainda soltava o
-- token de quem o tivesse antes. Com dois celulares na mesma conta, o último
-- a abrir o app roubava a notificação do outro — foi assim que o iPhone ficou
-- mudo enquanto o Android recebia.
--
-- A coluna Users.fcm_token NÃO é removida: continua sendo escrita com o token
-- mais recente, porque é ela que os ~20 pontos de envio já leem. O fan-out
-- para os demais aparelhos acontece no NotificationsService, a partir desta
-- tabela.

CREATE TABLE IF NOT EXISTS `Users_Devices` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `id_user`    INT NOT NULL,
  -- Único: um token identifica um aparelho. Se o celular troca de dono
  -- (porteiro sai, morador entra), o registro migra para o novo usuário em
  -- vez de duplicar.
  `fcm_token`  VARCHAR(500) NOT NULL,
  `plataforma` VARCHAR(20) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uni_users_devices_token` (`fcm_token`),
  KEY `idx_users_devices_user` (`id_user`),
  CONSTRAINT `fk_users_devices_user` FOREIGN KEY (`id_user`)
    REFERENCES `Users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Traz os tokens que já existem, para ninguém perder push no deploy.
INSERT IGNORE INTO `Users_Devices` (`id_user`, `fcm_token`)
SELECT `id`, `fcm_token`
  FROM `Users`
 WHERE `fcm_token` IS NOT NULL
   AND `fcm_token` <> '';
