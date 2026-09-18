# Click API (LEGACY - DESCONTINUADO / ARQUIVADO)

> ⚠️ **AVISO DE DEPRECIAÇÃO / UNIFICAÇÃO (Setembro/2026)**
>
> Este backend Express legado foi **100% unificado e migrado** para o monorepo oficial em NestJS:
> 📍 **`click-cond-web/apps/api`** (hospedado na AWS Elastic Beanstalk + RDS PostgreSQL).
>
> Todas as rotas legadas (áreas sociais, agendamentos, financeiro, auth mobile, condomínios e relatórios) possuem paridade e retrocompatibilidade implementadas no NestJS.
> O deploy e a manutenção ativa ocorrem exclusivamente via pipeline de CI/CD do GitHub Actions apontando para a AWS.
> Este diretório é mantido apenas como histórico/referência técnica.

This api uses the following technologies/libraries:

- Node.js
  - Express.js (routing)
  - Joi (schema validation)
  - JWT (auth)
  - Sequelize (added in the middle of project - used in admin routes).

Joi and Sequelize were add in the middle of the project to ensure more security and ease the process of fast development.

## How to run local (dev)

- `npm install`
- `npm run dev`

## How to deploy

- Source code is ES5 compatible so you can run it without building.

- `npm install`
- `npm start`
