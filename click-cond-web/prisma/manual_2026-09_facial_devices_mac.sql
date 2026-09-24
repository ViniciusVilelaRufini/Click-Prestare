-- Etapa 3 do agente: identidade do aparelho para reencontrá-lo quando o IP muda (DHCP).
ALTER TABLE Facial_Devices
  ADD COLUMN mac VARCHAR(17) NULL AFTER porta,
  ADD COLUMN numero_serie VARCHAR(64) NULL AFTER mac,
  ADD INDEX idx_facdev_mac (mac);
