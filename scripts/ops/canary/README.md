# Canary `prestare-health`

Código do canary CloudWatch Synthetics que vigia produção a cada 15 min (alarme `prestare-canary-falha`, runbook em `docs/operacao/runbooks.md` §5.7).

Publicar uma versão nova (CloudShell, conta 850401152034, sa-east-1):

```bash
cd scripts/ops/canary && zip -r /tmp/canary.zip nodejs
RT=$(aws synthetics describe-runtime-versions --query "RuntimeVersions[?starts_with(VersionName,'syn-nodejs-puppeteer') && DeprecationDate==null].VersionName" --output text | tr '\t' '\n' | sort -V | tail -1)
aws synthetics update-canary --name prestare-health --runtime-version "$RT" --code "Handler=saude.handler,ZipFile=fileb:///tmp/canary.zip"
aws synthetics start-canary --name prestare-health
```

Testar localmente antes (sem AWS): criar `node_modules/Synthetics` e `node_modules/SyntheticsLogger` falsos e chamar `require('./saude.js').handler()`.
