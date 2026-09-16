# Documentação de Ajustes e Melhorias - Click Condomínios

Este documento registra as alterações e correções realizadas no sistema **Click Condomínios** (API, App Flutter e Painel Web) para referência futura.

---

## 1. Identificação de Encomendas por Condomínio
**Objetivo:** Exibir claramente no aplicativo do morador o nome do condomínio de cada encomenda para evitar confusão quando o morador possuir unidades em mais de um condomínio.

### Alterações Realizadas:
* **Backend (API)**:
  * Arquivo: `click-cond-api/src/database/DB_Encomendas.js`
  * Ajuste: Atualizada a query do método `getAll` realizando um `LEFT JOIN` com a tabela `Condominios` para trazer o campo `c.nome as condominio_nome`.
* **App (Flutter)**:
  * Arquivo: `click-cond-app/lib/models/encomenda_model.dart`
  * Ajuste: Adicionado o campo `condominioNome` no modelo de dados, tratando a serialização/deserialização do JSON.
  * Arquivo: `click-cond-app/lib/pages/shared/encomendas/list_encomendas.dart`
  * Ajuste: Atualizado o widget `_EncomendaCard` para exibir o nome do condomínio em caixa alta e com destaque visual acima da descrição do pacote.

---

## 2. Correção de Login de Moradores (Bcrypt & MD5)
**Problema:** Quando um morador utilizava a recuperação de senha, a API gerava uma senha aleatória e a salvava usando criptografia moderna (`bcrypt`). Porém, a função de login dos moradores (`DB_Moradores.js`) realizava a consulta buscando estritamente pela senha criptografada em `MD5` (`u.password=MD5('${password}')`). Isso fazia com que o morador ficasse bloqueado permanentemente após recuperar a senha.

### Alterações Realizadas:
* **Backend (API)**:
  * Arquivo: `click-cond-api/src/database/DB_Moradores.js`
  * Ajuste: Reescrita a função de login para:
    1. Buscar o usuário pelo login.
    2. Verificar se o hash armazenado começa com `$2` (indicando `bcrypt`). Em caso afirmativo, realizar a comparação usando a biblioteca `bcrypt.compare`.
    3. Caso contrário, comparar usando o hash `MD5` legado.
    4. Se a senha bater usando `MD5`, realizar a migração transparente atualizando o banco de dados com a senha convertida em `bcrypt`.

---

## 3. Dropdown de Seleção de Destinatário no Painel Web (Portaria)
**Problema:** A portaria digitava o Bloco e Apto manualmente no cadastro de encomendas. Qualquer divergência de texto (ex: digitar `A` em vez de `Bloco A` ou errar o número do apartamento) fazia com que a encomenda ficasse órfã e não aparecesse no app do morador correto.

### Alterações Realizadas:
* **Web (Angular)**:
  * Arquivo: `click-cond-web/apps/portaria-web/src/app/encomendas/encomendas-page.component.ts`
  * Ajuste: Injetada a API de apartamentos (`ApartamentosApi`) para listar todas as unidades do condomínio atual ordenadas por Bloco e Apto.
  * Arquivo: `click-cond-web/apps/portaria-web/src/app/encomendas/encomendas-page.component.html`
  * Ajuste: Substituídos os campos de texto manuais `Bloco` e `Apto` por um único campo do tipo `<select>` (Dropdown) que lista e vincula as unidades válidas cadastradas.

---

## 4. Fluxo de Deploy e Git Branches
**Nota Importante:**
* O deploy automático de produção no **Vercel** está vinculado à branch **`main`**.
* O desenvolvimento local foi realizado inicialmente na branch `master`.
* Para subir as alterações e garantir que o Vercel realize o deploy com sucesso, as alterações devem ser enviadas à branch `main`.

### Comandos Git utilizados para publicação:
```powershell
# Commitar na master
git add -u
git commit -m "feat(encomendas): exibe nome do condominio no app, corrige fallback de bcrypt no login, adiciona dropdown de unidades no sistema web"
git push

# Mesclar com a branch de produção (main) e subir
git checkout main
git merge master
git push origin main
```
