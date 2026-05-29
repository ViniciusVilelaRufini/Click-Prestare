# Relatório Consolidado de Alterações do Dia (28/05/2026)

Este relatório compila todas as evoluções, reestruturações e implementações de segurança realizadas no sistema **Click-Prestare** no dia de hoje, abrangendo a reformulação da listagem de visitantes, reaproveitamento de biometria, fluxo de liberação administrativa, e o sistema de auditoria de segurança.

---

## 1. 👥 Reformulação da Listagem de Visitantes (1 Pessoa = 1 Linha)
*   **Problema Anterior:** Cada novo agendamento criava uma linha independente na tabela da portaria, gerando poluição visual quando o mesmo visitante vinha várias vezes.
*   **Implementação:**
    *   **Agrupamento no Backend (`listarPessoas`):** O service do backend agora agrupa todos os registros de visitas pelo documento do visitante (ou pelo nome, quando o documento está ausente).
    *   **Identificação Visual (Badges):** Adicionamos o badge **"+N visitas"** ao lado do nome do visitante para indicar que ele possui múltiplos agendamentos no histórico.
    *   **KPIs Atualizados:** Os contadores do topo da página ("Ativos no Local", "Inativos", "Total") agora refletem a contagem de **pessoas únicas**, e não de linhas brutas de visitas.
    *   **Operações Unificadas:**
        *   **Nova Visita Rápida:** Atalho no painel para criar um novo agendamento reutilizando dados de identidade da pessoa.
        *   **Edição Global (`atualizarPessoa`):** Alterar dados de identidade (nome, documento, foto) propaga a alteração automaticamente para todas as visitas passadas daquela pessoa.
        *   **Remoção em Lote (`removerPessoa`):** Excluir uma pessoa deleta todas as suas visitas associadas no banco e desvincula sua face dos terminais faciais.

---

## 2. 📸 Reaproveitamento de Fotos e Biometria Facial
*   **Auto-herança de dados:** Implementamos a busca em segundo plano (`buscarPessoa`). Ao digitar o CPF/RG do visitante no formulário, o sistema encontra o cadastro anterior mais completo (priorizando fotos de boa qualidade com sincronização facial ativa).
*   **Usar Dados Cadastrados:** O operador de portaria pode preencher os dados de nome e foto com um único clique.
*   **Evitar Duplicidade no Terminal:** O sistema herda o `face_id` do cadastro anterior e pula o processo de re-inscrição física, impedindo o acúmulo de faces duplicadas do mesmo usuário no leitor facial.

---

## 3. 🔑 Liberação Rápida vs. Entrada Física (Flag `liberado`)
*   **Separação de Estados:**
    *   `liberado = 1`: O morador ou portaria deu a pré-autorização de entrada. O visitante está apto a acessar.
    *   `data_entrada`: Registrado unicamente no momento em que o hardware (terminal facial, leitor de QR Code ou Tag) dispara o webhook confirmando a passagem física real.
*   **Reset de Estado na Saída:** Ao registrar o evento físico de saída no webhook, a liberação de visitantes comuns expira de volta para `liberado = 0`, evitando reentradas. Prestadores de serviço mantêm `liberado: 1` para permitir acessos múltiplos recorrentes.

---

## 4. 🛡️ Reforços de Segurança Contra Bypasses Físicos
*   **Validação de Vigência no Webhook:** O leitor facial barra acessos fora da janela de agendamento (`data_hora_inicio` e `data_hora_termino` com *grace period* de 15 min). Se expirada a janela, o status no banco é redefinido para `liberado = 0`.
*   **Validação de Liberação no PIN:** O endpoint `validarCodigo` (PIN de teclado) agora valida se `liberado === 1` antes de autenticar a entrada, impossibilitando bypasses por PINs antigos sem autorização ativa.
*   **Resolução de Tipagem para Funcionários:** O webhook agora reconhece moradores do tipo `'funcionario'` e aplica corretamente as regras de entrada correspondentes, resolvendo avisos de tipagem estática no TypeScript.

---

## 5. 📝 Logs de Auditoria e Rastreabilidade
*   **Integração do Log de Segurança:** Injetamos o `AuditoriaService` nos fluxos de visitantes.
*   **Rastreabilidade:** Toda criação de agendamento, check-in manual, check-out manual, liberação de acesso rápido, edição e exclusão de cadastros agora grava um registro estruturado na tabela `audit_logs` contendo:
    *   Quem fez a ação (Portaria, Morador ou Sistema).
    *   Timestamp preciso e IP de origem.
    *   Ação executada (`CREATE`, `UPDATE`, `DELETE`, `CHECK_IN`, `CHECK_OUT`).
    *   Descrição legível para o relatório do síndico.
