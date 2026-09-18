# DPA e Conformidade LGPD da AWS — Análise Técnica para a Assessoria Jurídica

**Data:** 18 de Setembro de 2026  
**Documento de Referência:** Substituição do `DPA_RAILWAY_PARA_ADVOGADA.md`  
**Objeto:** Infraestrutura de Nuvem AWS (Amazon Web Services) para armazenamento de Dados Pessoais e Dados Pessoais Sensíveis (Biometria Facial).  

---

## 1. Contexto e Mudança de Cenário (Railway ➔ AWS)

Anteriormente, o sistema Prestare utilizava o provedor Railway. Na auditoria jurídica de 11/09/2026, foram apontados dois riscos graves:
1. O formulário do Railway (*Exhibit A*) declarava falsamente ausência de dados sensíveis (*"Sensitive Data: None"*), enquanto o sistema efetivamente gravava fotos faciais, `face_id` e histórico de acessos biométricos.
2. O Railway mantinha os servidores primariamente nos Estados Unidos, sob jurisdição da Irlanda/GDPR, configurando transferência internacional de dados sem cláusulas-padrão da ANPD.

### Nova Situação com a AWS:
* **Infraestrutura Ativa:** AWS RDS (MySQL 8.0) e AWS Elastic Beanstalk hospedados no datacenter de **São Paulo, Brasil (`sa-east-1`)**.
* **Residência Nacional dos Dados:** **100% dos dados pessoais e biométricos estão no Brasil**, eliminando os riscos de transferência internacional desregulada (Art. 33 da LGPD).
* **Tratamento de Dados Sensíveis:** A AWS autoriza expressamente o processamento de dados biométricos sob o modelo de responsabilidade compartilhada, com criptografia AES-256 e certificação ISO/IEC 27018 (norma internacional de proteção de dados pessoais na nuvem).

---

## 2. Enquadramento dos Papéis sob a LGPD (Art. 5º e 39)

Na operação do sistema Prestare, a cadeia de agentes de tratamento é formalmente estruturada da seguinte forma:

```
[ CONDOMÍNIO ]            ➔        [ PRESTARE GESTÃO ]        ➔        [ AWS BRASIL ]
Controlador (Art. 5º, VI)          Operadora (Art. 5º, VII)            Suboperadora (Art. 39)
Define a finalidade do acesso      Licencia o software e trata        Fornece a infraestrutura física,
e coleta o consentimento           conforme instruções do Condomínio   banco de dados e segurança lógica
```

* **Controlador:** O Condomínio Contratante (responsável pela base de dados de moradores, visitantes e prestadores).
* **Operadora:** A Prestare Gestão Condominial Inteligente (trata os dados em nome do condomínio, prestando o serviço de controle de acesso e gestão).
* **Suboperadora (*Subprocessor*):** A Amazon Web Services (hospeda o banco de dados RDS, API e imagens faciais criptografadas).

---

## 3. Os Termos Contratuais Oficiais da AWS (DPA / LGPD)

A relação jurídica entre a Prestare e a AWS é regida pelos seguintes instrumentos contratuais vinculantes da Amazon:

### 3.1. Documentos Oficiais Aplicáveis
1. **AWS Customer Agreement (Contrato de Cliente AWS):**
   * Regula a prestação dos serviços de nuvem.
   * Disponível em: `https://aws.amazon.com/agreement/`
2. **AWS Data Processing Addendum - DPA (Aditivo de Tratamento de Dados):**
   * Regula os papéis de Operador/Suboperador, segurança, auditoria e sigilo.
   * Disponível em: `https://d1.awsstatic.com/legal/aws-dpa/aws-dpa.pdf`
3. **Brazil LGPD Addendum to AWS DPA (Aditivo Específico para o Brasil / LGPD):**
   * Aditivo que incorpora expressamente os requisitos da Lei Federal nº 13.709/2018 (LGPD), incluindo definições de Controlador, Operador, direitos dos titulares e notificações de incidentes.
   * Disponível em: `https://aws.amazon.com/compliance/lgpd-brazil/`

### 3.2. Como o DPA da AWS é Formalizado e Assinado
A AWS opera sob o modelo de adesão contratual digital com validade jurídica universal:
* O AWS DPA entra em vigor automaticamente no momento da criação da conta e utilização dos serviços para tratamento de dados pessoais.
* **Obtenção do DPA Assinado pela Amazon (para arquivo da Advogada):**
  A conta do Prestare pode baixar um exemplar formal e personalizado com o ID da conta diretamente no console da AWS via **AWS Artifact**:
  1. Acessar o console AWS ➔ buscar por **AWS Artifact**;
  2. Ir em **Agreements** (Contratos);
  3. Localizar **AWS Data Processing Addendum (including LGPD Addendum)**;
  4. Clicar em **Download** ou **Accept Agreement**. O sistema gera um PDF assinado digitalmente pela Amazon para anexar ao dossiê de conformidade da empresa.

---

## 4. Medidas Técnicas e de Segurança Aplicadas aos Dados Biométricos (Art. 46 LGPD)

Em atendimento às exigências contratuais da Cláusula 8 do Contrato de Licença e da Seção de Segurança do DPA com os condomínios, a nova infraestrutura na AWS implementa:

| Medida de Segurança | Implementação na AWS Prestare | Requisito LGPD |
| :--- | :--- | :--- |
| **Criptografia em Repouso** | Tabelas com dados biométricos (`foto_pessoa`, `face_id`, `Acessos_Facial`) armazenadas no Amazon RDS com volume EBS criptografado por **AES-256**. | Art. 46 (Segurança e Sigilo) |
| **Criptografia em Trânsito** | Todas as conexões de API e tráfego mobile utilizam **TLS 1.2 / TLS 1.3** com certificados SSL/HTTPS forçados. | Art. 46 (Integridade e Confidencialidade) |
| **Localização Física dos Servidores** | Datacenter em **São Paulo (`sa-east-1`)**, garantindo jurisdição brasileira e ausência de transferência internacional de biometria. | Art. 33 (Transferência Internacional) |
| **Segregação de Redes (VPC)** | O banco de dados RDS fica em sub-rede isolada (VPC privada), inacessível publicamente pela internet, aceitando conexões apenas da API e IPs autenticados. | Art. 46 (Prevenção e Acesso Indevido) |
| **Backups Automatizados** | Snapshots automatizados diários no RDS com retenção garantida e capacidade de Point-in-Time Restore. | Art. 48 (Continuidade e Disponibilidade) |
| **Certificações Globais da AWS** | ISO/IEC 27001, ISO/IEC 27017, **ISO/IEC 27018** (privacidade em nuvem), SOC 1, SOC 2 Type II e SOC 3. | Padrão ouro exigido por auditorias |

---

## 5. Minuta Sugerida para Atualização do Anexo II (Contrato com Condomínios)

Para que o contrato firmado entre a Prestare e os Condomínios (ex.: Condomínio Veredas do Sol) reflita a nova realidade da infraestrutura AWS, sugere-se à assessoria jurídica a inserção da seguinte redação no **Anexo II (Acordo de Tratamento de Dados Pessoais - DPA)**:

> **"CLÁUSULA DE SUBOPERADORES (INFRAESTRUTURA DE NUVEM):**  
> A CONTRATADA (Prestare Gestão) declara que, para a execução dos serviços de hospedagem de software, banco de dados e processamento seguro de imagens e dados biométricos faciais, utiliza infraestrutura provida pela **Amazon Web Services (AWS)** — *Amazon Serviços de Varejo do Brasil Ltda.*, sob datacenter localizado na Região América do Sul (**São Paulo, Brasil**), sujeita ao *AWS Data Processing Addendum (DPA)* e em estrita conformidade com a Lei Federal nº 13.709/2018 (LGPD), restando vedada a transferência internacional não autorizada de dados biométricos sensíveis dos condôminos."

---

## 6. Parecer Conclusivo para a Advogada

1. **Risco Railway Sanado:** O problema de falsa declaração de ausência de dados sensíveis e a transferência internacional involuntária para os EUA/Irlanda foram **completamente eliminados**.
2. **Conformidade da Biometria Facial:** Os dados biométricos encontram-se respaldados pelas normas de segurança mais rigorosas do mercado (AWS sa-east-1 com criptografia de ponta e isolamento em VPC).
3. **Formalização Documental:** A documentação necessária para o dossiê da empresa consiste neste relatório técnico acompanhado do PDF do **AWS DPA** disponível via AWS Artifact.
