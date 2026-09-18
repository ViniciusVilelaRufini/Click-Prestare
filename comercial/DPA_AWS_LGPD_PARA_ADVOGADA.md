# Dossiê de Conformidade LGPD e Infraestrutura AWS — Prestare Gestão

**Data de Emissão:** 18 de Setembro de 2026  
**Finalidade:** Parecer Técnico-Jurídico e Comprovação Material de Conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018)  
**Destinatário:** Assessoria Jurídica / DPO / Clientes Controladores (Condomínios)  
**Documento Anterior Substituído:** `DPA_RAILWAY_PARA_ADVOGADA.md` (Revogado após descomissionamento total do Railway)  

---

## 1. Identificação Formal da Conta e Titularidade na AWS

Para comprovar perante auditorias, condôminos e a Autoridade Nacional de Proteção de Dados (ANPD) que a **Prestare Gestão** é a titular legítima da infraestrutura contratada, registram-se os dados unívocos da contratação:

| Campo Cadastral | Informação Oficial Registrada |
| :--- | :--- |
| **Titular da Conta AWS** | **Prestare Gestão Condominial Inteligente** |
| **AWS Account ID (Identificador Único)** | **`850401152034`** |
| **Entidade Contratada no Brasil** | **Amazon Serviços de Varejo do Brasil Ltda.** / AWS Brasil |
| **Datacenter e Região Geográfica** | **América do Sul (São Paulo) — `sa-east-1`** |
| **Status da Conta** | Ativa, adimplente e operando sob o *AWS Customer Agreement* |

> **Fundamento Jurídico de Vínculo (Cláusula 1.4 do AWS Customer Agreement):**  
> Os termos do *AWS Customer Agreement* e do *AWS Data Processing Addendum (DPA)* aplicam-se expressa e diretamente à conta identificada pelo **AWS Account ID `850401152034`**, vinculando todos os dados processados e armazenados sob essa credencial às obrigações de sigilo, suboperação e segurança da Amazon.

---

## 2. Inventário de Recursos Ativos Vinculados à Conta `850401152034`

A comprovação material de que os dados pessoais e biométricos estão fisicamente alocados no território nacional brasileiro (São Paulo) é evidenciada pelos endpoints emitidos e certificados criptograficamente pela AWS:

### 2.1. Banco de Dados Relacional de Produção (AWS RDS)
* **Instância:** `database-1`
* **Engine:** MySQL Community 8.0.x
* **Endpoint de Conexão:** `database-1.crq2ie2ww3dh.sa-east-1.rds.amazonaws.com`
* **Localização Física:** Datacenter de São Paulo (`sa-east-1`)
* **Dados Armazenados:** 63 tabelas, incluindo cadastro de moradores, unidades, histórico de acessos (`Acessos_Facial`), permissões e tabelas de consentimento.
* **Mecanismo de Segurança:** Isolamento em Virtual Private Cloud (VPC), sem acesso público externo, e criptografia em repouso por hardware via **AES-256 (AWS KMS)**.

### 2.2. Servidor de Aplicação e Processamento (AWS Elastic Beanstalk)
* **Ambiente Ativo:** `Clickprestareapi-env` (Aplicação: `clickprestare-api`)
* **Endpoint:** `Clickprestareapi-env.eba-bcmjawac.sa-east-1.elasticbeanstalk.com`
* **Região:** São Paulo (`sa-east-1`)
* **Papel:** Backend em Node.js 24 responsável pela intermediação das regras de negócio, autenticação JWT com expiração e comunicação com terminais de controle de acesso.

---

## 3. Contexto da Migração e Superação dos Riscos Anteriores

Na auditoria do fornecedor anterior (**Railway Corporation**, sediado nos EUA), a assessoria jurídica apontou dois pontos críticos de vulnerabilidade (registrados no dossiê de 11/09/2026):
1. **Falsa declaração no DPA anterior:** O formulário do Railway declarava *"Sensitive Data: None"*, o que colidia com a realidade do sistema (que processa biometria facial, dado sensível pelo Art. 5º, II da LGPD).
2. **Transferência Internacional Desregulada:** O tráfego e armazenamento ocorriam primariamente nos EUA, sob foro da Irlanda, sem aderência às cláusulas-padrão da ANPD.

### Como a AWS Sanou Integralmente Esses Riscos:
* **Fim da Transferência Internacional:** Com o provisionamento no datacenter de São Paulo (`sa-east-1`), **100% dos dados biométricos e cadastrais residem no Brasil**, sob plena jurisdição da legislação brasileira e do foro da Comarca de São Paulo.
* **Admissão e Proteção de Dados Sensíveis:** Diferente do formulário errôneo anterior, a AWS reconhece e autoriza o processamento de dados biométricos, fornecendo as garantias da norma internacional **ISO/IEC 27018** (código de conduta específico para proteção de dados pessoais e biometria em nuvens públicas).

---

## 4. Estrutura da Cadeia de Tratamento sob a LGPD

```
[ CONDOMÍNIO ]            ➔        [ PRESTARE GESTÃO ]        ➔        [ AWS BRASIL ]
Controlador (Art. 5º, VI)          Operadora (Art. 5º, VII)            Suboperadora (Art. 39)
Conta ID: Condomínio               Prestare Gestão Condominial         AWS Account ID: 850401152034
Define a finalidade e base         Trata dados por ordem do            Hospeda o banco RDS, API e
legal (segurança/acesso)           Controlador e licencia o software   aplica a segurança física e lógica
```

* **Controlador:** O Condomínio Contratante.
* **Operadora:** Prestare Gestão Condominial Inteligente.
* **Suboperadora (*Subprocessor*):** Amazon Web Services (sob a conta `850401152034`).

---

## 5. Instrumentos Contratuais Vinculantes e Validade Jurídica

A relação com a AWS é regida pelos seguintes documentos legais oficiais:

1. **AWS Customer Agreement (Contrato de Cliente):**
   * Regula a prestação de serviços de infraestrutura e vincula a conta `850401152034`.
   * Disponível publicamente em: `https://aws.amazon.com/agreement/`
2. **AWS Data Processing Addendum (DPA) & Brazil LGPD Addendum:**
   * Aditivo contratual que estabelece as cláusulas de suboperação, confidencialidade, auxílio em direitos dos titulares e notificação de incidentes.
   * **Incorporação Automática:** Conforme os Termos de Serviço da Amazon, o DPA aplica-se **automaticamente** a todas as contas que tratam dados pessoais sob a LGPD, prescindindo de firma física ou DocuSign manual.
   * **Cópia Oficial Arquivada no Projeto:**
     📁 `comercial/AWS_Data_Processing_Addendum_LGPD.pdf` (disponível para anexar ao parecer).
3. **Comprovante de Faturamento / Nota Fiscal da Conta `850401152034`:**
   * A fatura mensal emitida pela AWS (acessível no console em *Billing > Faturas*) discrimina a Razão Social da Prestare, o Account ID `850401152034` e os serviços ativos em São Paulo, servindo como documento fiscal comprobatório da relação contratual.

---

## 6. Medidas Técnicas de Segurança Aplicadas aos Dados Biométricos (Art. 46 LGPD)

| Requisito Legal (LGPD) | Implementação Técnica na Conta AWS `850401152034` |
| :--- | :--- |
| **Criptografia em Repouso** | Volumes de armazenamento EBS do banco de dados RDS criptografados por chave gerenciada via hardware com algoritmo **AES-256**. |
| **Criptografia em Trânsito** | Toda a comunicação (Web, Mobile e Catracas) opera obrigatoriamente sob protocolo criptográfico **TLS 1.2 / TLS 1.3** com HTTPS forçado. |
| **Isolamento de Redes (VPC)** | Banco de dados RDS alocado em Virtual Private Cloud privada, inacessível diretamente por IPs externos e blindado por Security Groups. |
| **Continuidade e Backups** | Rotina de snapshots automatizados diários no RDS com retenção garantida e capacidade de recuperação pontual no tempo (*Point-in-Time Restore*). |
| **Auditoria e Certificações** | Datacenter de São Paulo auditado e certificado sob as normas **ISO/IEC 27001, ISO/IEC 27017 e ISO/IEC 27018** (Proteção de Dados Pessoais em Nuvem), além de relatórios **SOC 2 Type II**. |

---

## 7. Minuta Sugerida para Atualização Contratual (Anexo II dos Condomínios)

Sugere-se à assessoria jurídica a inserção da seguinte redação no **Anexo II (DPA Condomínio-Prestare)** de todos os contratos vigentes e futuros:

> **"CLÁUSULA DE SUBOPERADORES E INFRAESTRUTURA DE DADOS:**  
> A CONTRATADA (Prestare Gestão) declara que, para a hospedagem do banco de dados, aplicação e processamento seguro de imagens e biometria facial, utiliza infraestrutura de nuvem provida pela **Amazon Web Services (AWS)** — *Amazon Serviços de Varejo do Brasil Ltda.*, sob a conta corporativa de **ID nº 850401152034**, alocada fisicamente na Região América do Sul (**São Paulo, Brasil — `sa-east-1`**).  
> O tratamento de dados observa integralmente o *AWS Data Processing Addendum (DPA)* e a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), restando garantido que os dados pessoais e biométricos dos condôminos não são objeto de transferência internacional desregulada e permanecem resguardados por criptografia padrão AES-256 e certificação ISO/IEC 27018."

---

## 8. Parecer Conclusivo

A migração para a conta AWS `850401152034` em São Paulo elevou a segurança jurídica e técnica do sistema Prestare ao mais alto padrão de conformidade exigido pela LGPD e pelas auditorias de condomínios. O conjunto probatório é formado por:
1. Este Dossiê Técnico-Jurídico;
2. O contrato oficial da Amazon (`comercial/AWS_Data_Processing_Addendum_LGPD.pdf`);
3. As faturas e comprovantes cadastrais da conta `850401152034` no console AWS.
