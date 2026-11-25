-- Integridade do banco de produção — SÓ LEITURA. Cada linha: checagem, quantidade, esperado.
SET SESSION TRANSACTION READ ONLY;
SET SESSION max_execution_time = 20000;

SELECT 'users_email_duplicado' chk, COUNT(*) n, '0' esperado FROM (SELECT LOWER(TRIM(email)) e FROM Users WHERE email IS NOT NULL AND TRIM(email)<>'' GROUP BY e HAVING COUNT(*)>1) d
UNION ALL SELECT 'users_cpf_duplicado', COUNT(*), '0' FROM (SELECT REGEXP_REPLACE(cpf,'[^0-9]','') c FROM Users WHERE cpf IS NOT NULL AND REGEXP_REPLACE(cpf,'[^0-9]','')<>'' GROUP BY c HAVING COUNT(*)>1) d
UNION ALL SELECT 'users_login_duplicado', COUNT(*), '0' FROM (SELECT LOWER(TRIM(login)) l FROM Users WHERE login IS NOT NULL AND TRIM(login)<>'' GROUP BY l HAVING COUNT(*)>1) d
UNION ALL SELECT 'users_sem_senha', COUNT(*), 'info' FROM Users WHERE password IS NULL OR password=''
UNION ALL SELECT 'users_senha_nao_bcrypt', COUNT(*), '0' FROM Users WHERE password IS NOT NULL AND password<>'' AND password NOT LIKE '$2%'
UNION ALL SELECT 'moradores_user_inexistente', COUNT(*), '0' FROM Moradores m LEFT JOIN Users u ON u.id=m.id_user WHERE u.id IS NULL
UNION ALL SELECT 'moradores_sem_unidade_cadastrada', COUNT(*), '0' FROM Moradores m WHERE m.id_condominio IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Apartamentos a WHERE a.id_condominio=m.id_condominio AND COALESCE(a.bloco,'')=COALESCE(m.bloco,'') AND COALESCE(a.apto,'')=COALESCE(m.apartamento,''))
UNION ALL SELECT 'vinculo_unidade_sem_morador', COUNT(*), 'info' FROM Apartamentos_Users au JOIN Apartamentos a ON a.id=au.id_apto WHERE NOT EXISTS (SELECT 1 FROM Moradores m WHERE m.id_user=au.id_user AND m.id_condominio=a.id_condominio AND COALESCE(m.bloco,'')=COALESCE(a.bloco,'') AND COALESCE(m.apartamento,'')=COALESCE(a.apto,''))
UNION ALL SELECT 'qr_morador_ativo_sem_morador', COUNT(*), '0' FROM Credenciais_Acesso c LEFT JOIN Moradores m ON m.id=c.id_pessoa WHERE c.tipo_pessoa='morador' AND c.revogada_em IS NULL AND m.id IS NULL
UNION ALL SELECT 'qr_morador_ativo_outro_condominio', COUNT(*), '0' FROM Credenciais_Acesso c JOIN Moradores m ON m.id=c.id_pessoa WHERE c.tipo_pessoa='morador' AND c.revogada_em IS NULL AND m.id_condominio<>c.id_condominio
UNION ALL SELECT 'qr_visita_ativo_visita_inexistente', COUNT(*), '0' FROM Credenciais_Acesso c LEFT JOIN visitas v ON v.id=c.id_visita WHERE c.id_visita IS NOT NULL AND c.revogada_em IS NULL AND v.id IS NULL
UNION ALL SELECT 'visita_apto_de_outro_condominio', COUNT(*), '0' FROM visitas v JOIN Apartamentos a ON a.id=v.id_apartamento WHERE a.id_condominio<>v.id_condominio
UNION ALL SELECT 'visita_pessoa_de_outro_condominio', COUNT(*), '0' FROM visitas v JOIN pessoas p ON p.id=v.id_pessoa WHERE p.id_condominio<>v.id_condominio
UNION ALL SELECT 'visita_dentro_ha_mais_de_2_dias', COUNT(*), 'info' FROM visitas WHERE data_entrada IS NOT NULL AND data_saida IS NULL AND data_entrada < NOW() - INTERVAL 2 DAY
UNION ALL SELECT 'visita_auth_pendente_mais_1h', COUNT(*), '0' FROM visitas WHERE auth_status='pendente' AND auth_solicitado_em < NOW() - INTERVAL 1 HOUR
UNION ALL SELECT 'visita_saida_antes_entrada', COUNT(*), '0' FROM visitas WHERE data_saida IS NOT NULL AND data_entrada IS NOT NULL AND data_saida < data_entrada
UNION ALL SELECT 'visita_termino_antes_inicio', COUNT(*), '0' FROM visitas WHERE data_hora_termino IS NOT NULL AND data_hora_inicio IS NOT NULL AND data_hora_termino < data_hora_inicio
UNION ALL SELECT 'pin_ativo_repetido_mesmo_cond', COUNT(*), '0' FROM (SELECT id_condominio, codigo_acesso FROM visitas WHERE codigo_acesso IS NOT NULL AND data_saida IS NULL AND (data_hora_termino IS NULL OR data_hora_termino > NOW()) GROUP BY 1,2 HAVING COUNT(*)>1) d
UNION ALL SELECT 'reserva_area_apto_outro_cond', COUNT(*), '0' FROM Areas_Sociais_Agendamentos g JOIN Areas_Sociais s ON s.id=g.id_area_social JOIN Apartamentos a ON a.id=g.id_apartamento WHERE a.id_condominio<>s.id_condominio
UNION ALL SELECT 'reserva_futura_sobreposta', COUNT(*), '0' FROM Areas_Sociais_Agendamentos x JOIN Areas_Sociais_Agendamentos y ON y.id_area_social=x.id_area_social AND y.id>x.id AND y.data=x.data AND y.hora_de<x.hora_ate AND x.hora_de<y.hora_ate WHERE x.data>=CURDATE() AND x.status NOT IN ('cancelado','cancelada','recusado','recusada') AND y.status NOT IN ('cancelado','cancelada','recusado','recusada')
UNION ALL SELECT 'reserva_sem_dono_futura', COUNT(*), 'info' FROM Areas_Sociais_Agendamentos WHERE id_user IS NULL AND data>=CURDATE()
UNION ALL SELECT 'vaga_apto_outro_cond', COUNT(*), '0' FROM Vagas v JOIN Apartamentos a ON a.id=v.id_apartamento WHERE a.id_condominio<>v.id_condominio
UNION ALL SELECT 'vaga_ativa_veiculo_outra_unidade', COUNT(*), 'info' FROM Vagas v JOIN Veiculos ve ON ve.id=v.id_veiculo JOIN Moradores m ON m.id=ve.id_morador WHERE v.ativo=1 AND m.id_condominio<>v.id_condominio
UNION ALL SELECT 'tag_device_outro_cond', COUNT(*), '0' FROM Tags t JOIN Facial_Devices d ON d.id=t.id_device WHERE d.id_condominio<>t.id_condominio
UNION ALL SELECT 'facial_device_ativo_sem_sincr_24h', COUNT(*), 'info' FROM Facial_Devices WHERE ativo=1 AND (ultima_sincr IS NULL OR ultima_sincr < NOW() - INTERVAL 1 DAY)
UNION ALL SELECT 'facial_area_outro_cond', COUNT(*), '0' FROM Facial_Devices d JOIN Areas_Sociais s ON s.id=d.id_area_social WHERE s.id_condominio<>d.id_condominio
UNION ALL SELECT 'webhook_token_repetido', COUNT(*), '0' FROM (SELECT webhook_token FROM Facial_Devices GROUP BY webhook_token HAVING COUNT(*)>1) d
UNION ALL SELECT 'morador_face_error', COUNT(*), 'info' FROM Moradores WHERE face_sync_status='error'
UNION ALL SELECT 'morador_face_pending_mais_1d', COUNT(*), 'info' FROM Moradores WHERE face_sync_status IN ('pending','pending_removal') AND updated_at < NOW() - INTERVAL 1 DAY
UNION ALL SELECT 'agente_cmd_pendente_expirado', COUNT(*), 'info' FROM agente_comandos WHERE status IN ('pendente','pending') AND expira_em < NOW()
UNION ALL SELECT 'agente_cmd_total', COUNT(*), 'info' FROM agente_comandos
UNION ALL SELECT 'card_ao_vivo_aberto_mais_1d', COUNT(*), '0' FROM Cards_Ao_Vivo WHERE encerrado_em IS NULL AND created_at < NOW() - INTERVAL 1 DAY
UNION ALL SELECT 'redef_senha_ativa', COUNT(*), 'info' FROM redefinicoes_senha WHERE usado_em IS NULL AND expira_em > NOW()
UNION ALL SELECT 'redef_senha_expirada_acumulada', COUNT(*), 'info' FROM redefinicoes_senha WHERE expira_em < NOW() - INTERVAL 7 DAY
UNION ALL SELECT 'mfa_challenge_expirado_acumulado', COUNT(*), 'info' FROM mfa_challenges WHERE expires_at < NOW() - INTERVAL 1 DAY
UNION ALL SELECT 'device_fcm_repetido_users_dif', COUNT(*), '0' FROM (SELECT fcm_token FROM Users_Devices GROUP BY fcm_token HAVING COUNT(DISTINCT id_user)>1) d
UNION ALL SELECT 'consentimento_privacidade_faltando', COUNT(*), 'info' FROM Users u WHERE u.is_morador=1 AND NOT EXISTS (SELECT 1 FROM Consentimentos c WHERE c.id_user=u.id AND c.tipo='privacidade');

SELECT 'tabela_sem_pk' chk, TABLE_NAME FROM information_schema.TABLES t WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS c WHERE c.TABLE_SCHEMA=t.TABLE_SCHEMA AND c.TABLE_NAME=t.TABLE_NAME AND c.CONSTRAINT_TYPE='PRIMARY KEY');
SELECT 'tabela_nao_innodb_ou_utf8mb4' chk, TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND (ENGINE<>'InnoDB' OR TABLE_COLLATION NOT LIKE 'utf8mb4%');
SELECT 'fk_sem_indice' chk, k.TABLE_NAME, k.COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL AND NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS s WHERE s.TABLE_SCHEMA=k.TABLE_SCHEMA AND s.TABLE_NAME=k.TABLE_NAME AND s.COLUMN_NAME=k.COLUMN_NAME AND s.SEQ_IN_INDEX=1);
SELECT 'maiores_tabelas' chk, TABLE_NAME, TABLE_ROWS, ROUND((DATA_LENGTH+INDEX_LENGTH)/1048576,1) mb FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY DATA_LENGTH+INDEX_LENGTH DESC LIMIT 6;
SELECT 'mysql' chk, @@max_connections max_conn, (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Max_used_connections') usadas_max, (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Threads_connected') agora, (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Aborted_connects') abortadas, (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Slow_queries') lentas, @@time_zone tz, @@sql_mode sql_mode;
