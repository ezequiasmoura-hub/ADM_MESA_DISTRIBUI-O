# Configuracoes

Este documento explica as variaveis de ambiente, configuracoes da tela e caminhos usados pela aplicacao.

## Fontes de configuracao

A aplicacao carrega configuracoes nesta ordem:

1. `.env` na raiz do projeto;
2. `inputMesa/.env`;
3. `mesa_config.json` salvo na pasta de dados do usuario do Electron;
4. normalizacao interna em `main.js`.

No app empacotado, a pasta de dados do usuario e obtida com:

```js
app.getPath('userData')
```

## Arquivos sensiveis

Nunca versionar:

- `.env`;
- `inputMesa/.env`;
- `mesa_config.json` real;
- logs;
- CSVs e planilhas geradas;
- tokens, secrets e senhas.

## Genesys

### `ORG_REGION`

Regiao Genesys usada pelo SDK.

Exemplo:

```env
ORG_REGION=sa_east_1
```

### `CLIENT_ID`

Client ID do OAuth Client Credentials.

```env
CLIENT_ID=seu_client_id_oauth
```

### `CLIENT_SECRET`

Client secret do OAuth. Nunca coloque valor real em documentacao ou commit.

```env
CLIENT_SECRET=seu_client_secret_oauth
```

Na UI, se o secret ja estiver salvo, o campo fica vazio com indicador de que existe valor configurado. Deixar vazio preserva o valor anterior.

### `QUEUE_ID` e `QUEUE_IDS`

Filas usadas para consulta da mesa, deduplicacao e filtros.

```env
QUEUE_IDS=queue-id-1,queue-id-2
```

`QUEUE_ID` singular e aceito como fallback.

Se as filas nao estiverem no mapa padrao do app, informe o estado antes do ID:

```env
QUEUE_IDS=GO|queue-id-gd-go,MA|queue-id-gd-ma
```

Na consulta da mesa, o app usa somente o ID. O prefixo `GO|` serve para a interface identificar o estado.

## Pastas locais

### `INPUT_MESA_DIR`

Pasta onde fica o CSV final `mesa_distribuicao.csv`.

```env
INPUT_MESA_DIR=C:\Caminho\Operacional\inputMesa
```

Se vazio:

- em desenvolvimento: usa `inputMesa/` dentro do projeto;
- no app empacotado: usa `app.getPath('userData')/inputMesa`.

### `LOG_DIR`

Pasta raiz dos logs.

```env
LOG_DIR=C:\Caminho\Operacional\logs
```

Se vazio, usa `app.getPath('userData')/logs`.

## Limpeza

### `CLEANUP_CONCURRENCY`

Quantidade de conversas processadas em paralelo.

```env
CLEANUP_CONCURRENCY=10
```

Na UI aparece como **paralelo**.

### `CLEANUP_RATE_LIMIT_PER_MINUTE`

Limite de requisicoes de limpeza iniciadas por minuto.

```env
CLEANUP_RATE_LIMIT_PER_MINUTE=280
```

Padrao: `280`. A normalizacao limita a no maximo `300`.

Quando `CLEANUP_USE_UPLOAD_CREDENTIALS=1`, esse limite passa a ser aplicado por credencial ativa. Com 6 credenciais e valor `280`, o limite efetivo pode chegar a `1680 req/min`, mantendo controle de 429 por credencial.

### `CLEANUP_RATE_LIMIT_FALLBACK_SECONDS`

Tempo de espera quando a Genesys retorna `429` sem `Retry-After`.

```env
CLEANUP_RATE_LIMIT_FALLBACK_SECONDS=30
```

### `CLEANUP_USE_UPLOAD_CREDENTIALS`

Usa as credenciais configuradas em `MESA_UPLOAD_CREDENTIALS` tambem para consulta detalhada e limpeza da mesa.

```env
CLEANUP_USE_UPLOAD_CREDENTIALS=1
```

Quando ativado, cada credencial recebe seu proprio rate limiter. Se alguma credencial receber `429`, apenas ela pausa e o processo continua com as demais quando possivel.

### `CLEANUP_MAX_CREDENTIALS`

Quantidade maxima de credenciais da subida usadas pela limpeza.

```env
CLEANUP_MAX_CREDENTIALS=6
```

Use para limitar o pool mesmo quando existirem mais credenciais cadastradas.

### `CLEANUP_QUEUE_IDS`

IDs de fila usados pela limpeza por estado/fila quando nao ha filtros detalhados.

```env
CLEANUP_QUEUE_IDS=queue-id-al,queue-id-go
```

Na UI, informe um ID por linha. Para filas fora do padrao de Varejo, use:

```env
CLEANUP_QUEUE_IDS=GO|queue-id-gd-go,MA|queue-id-gd-ma
```

Quando `CLEANUP_QUEUE_IDS` fica vazio ou permanece igual ao padrao legado, a limpeza por ID da mesa usa os `QUEUE_IDS` configurados. Isso evita que uma instalacao configurada para GD continue consultando IDs antigos de Varejo.

### `MESA_DETAIL_RETRIES`

Tentativas de leitura detalhada de conversas.

```env
MESA_DETAIL_RETRIES=30
```

### `MESA_DETAIL_RETRY_DELAY_MS`

Intervalo entre tentativas detalhadas.

```env
MESA_DETAIL_RETRY_DELAY_MS=1500
```

### `MESA_PROTOCOL_CONCURRENCY`

Concorrencia em consultas individuais de fallback.

```env
MESA_PROTOCOL_CONCURRENCY=12
```

### `MESA_PROTOCOL_INTERVAL_DAYS`

Janela maxima da consulta analitica individual.

```env
MESA_PROTOCOL_INTERVAL_DAYS=30
```

## Subida da mesa

A subida da mesa e feita pelo script JavaScript empacotado `scripts/mesa-upload.js`. As credenciais ficam no app/.env ou na tela **Configuracoes**, nunca dentro do script.

### `MESA_UPLOAD_STRATEGY`

```env
MESA_UPLOAD_STRATEGY=paced
```

Valores:

- `paced`;
- `batch`;
- `serial`.

### `MESA_UPLOAD_CREDENTIALS`

Credenciais exclusivas da subida. Use uma credencial por linha no formato:

```env
MESA_UPLOAD_CREDENTIALS=URA_0|client_id|client_secret;URA_1|client_id|client_secret
```

Se ficar vazio, o upload usa `CLIENT_ID` e `CLIENT_SECRET` do Genesys.

### `MESA_UPLOAD_WORKERS`

Quantidade de workers da subida JS integrada.

```env
MESA_UPLOAD_WORKERS=5
```

O app normaliza para no maximo `5`.

### `MESA_UPLOAD_INTERVAL_SECONDS`

Intervalo entre inicios de envio no modo `paced`.

```env
MESA_UPLOAD_INTERVAL_SECONDS=2
```

### `MESA_UPLOAD_BATCH_PAUSE_SECONDS`

Pausa entre lotes.

```env
MESA_UPLOAD_BATCH_PAUSE_SECONDS=2
```

### `MESA_UPLOAD_TIMEOUT_MINUTES`

Timeout do processo externo. `0` significa sem timeout imposto pelo Electron.

```env
MESA_UPLOAD_TIMEOUT_MINUTES=0
```

### Variaveis do script JS

```env
MESA_REQUEST_RETRIES=8
MESA_REQUEST_TIMEOUT_SECONDS=25
MESA_RATE_LIMIT_SLEEP_SECONDS=30
MESA_TOKEN_RETRIES=8
MESA_TOKEN_RETRY_SECONDS=15
MESA_DRY_RUN=0
```

`MESA_DRY_RUN=1` deve ser usado somente para diagnostico da subida JS.
`MESA_DRY_RUN=1` simula a leitura do CSV sem criar conversas no Genesys.

## Extracoes

### Credencial geral

```env
EXTRACAO_USUARIO=usuario_exemplo
EXTRACAO_SENHA=senha_exemplo
```

### Credenciais por extrator

```env
EXTRACAO_SITE_NOVO_USUARIO=usuario_site_novo
EXTRACAO_SITE_NOVO_SENHA=senha_site_novo
EXTRACAO_SITE_ANTIGO_USUARIO=usuario_site_antigo
EXTRACAO_SITE_ANTIGO_SENHA=senha_site_antigo
EXTRACAO_GO_USUARIO=usuario_go
EXTRACAO_GO_SENHA=senha_go
EXTRACAO_RS_USUARIO=usuario_rs
EXTRACAO_RS_SENHA=senha_rs
```

A credencial especifica tem prioridade sobre a geral.

### Retentativa e validacao das bases

```env
EXTRACTION_RETRY_DELAY_SECONDS=15
EXTRACTION_MAX_ATTEMPTS=0
```

Site Antigo, GO e RS somente terminam com sucesso quando o CSV foi atualizado na tentativa atual, possui o cabecalho esperado e contem pelo menos um registro. Erros e arquivos zerados aguardam o intervalo configurado e executam novamente. `EXTRACTION_MAX_ATTEMPTS=0` significa tentativas ilimitadas; um valor positivo limita a quantidade de tentativas.

### `EXTRACAO_HEADLESS`

```env
EXTRACAO_HEADLESS=1
```

Use `0` para diagnostico com navegador visivel.

### `EXTRACAO_BROWSER_CHANNEL`

Canal de navegador usado como fallback pelo Playwright quando o Chromium padrao nao existe na maquina.

```env
EXTRACAO_BROWSER_CHANNEL=msedge
```

Valores comuns: `msedge` ou `chrome`.

### `EXTRACAO_CHROMIUM_EXECUTABLE`

Caminho absoluto opcional para um Chromium/Chrome/Edge especifico.

```env
EXTRACAO_CHROMIUM_EXECUTABLE=C:\Caminho\chrome.exe
```

Use apenas quando o fallback por canal nao funcionar.

### `EXTRACAO_BASE_DIR`

Pasta onde os extratores salvam bases.

```env
EXTRACAO_BASE_DIR=C:\Bases\Mesa
```

### Site Novo

```env
EXTRACAO_SITE_NOVO_SCRIPT=
EXTRACAO_SITE_NOVO_CDP=0
EXTRACAO_SITE_NOVO_RETRY_MS=30000
EXTRACAO_SITE_NOVO_MAX_TENTATIVAS=3
EXTRACAO_SITE_NOVO_START_DATE=2026-01-01
```

### Concorrencia dos extratores

```env
EXTRACAO_SITE_ANTIGO_SCRIPT=
EXTRACAO_GO_SCRIPT=
EXTRACAO_RS_SCRIPT=
EXTRACAO_ANTIGO_CONCORRENCIA=50
EXTRACAO_GO_CONCORRENCIA=100
EXTRACAO_RS_CONCORRENCIA=100
```

## Runtime

### `NODE_BIN`

Runtime usado para scripts Node em desenvolvimento. No app empacotado, se vazio, a aplicacao usa o proprio executavel Electron com `ELECTRON_RUN_AS_NODE=1`.

```env
NODE_BIN=node
```

## Configuracoes da tela

- **Modo claro**: alterna tema.
- **Pastas locais**: define `INPUT_MESA_DIR` e `LOG_DIR`.
- **Bases**: caminhos das planilhas/CSVs usados para gerar a mesa.
- **Credenciais de extracao**: usuario/senha por origem.
- **Genesys Cloud**: regiao, client id, client secret e filas.
- **Velocidade da limpeza**: paralelo, req/min e fallback 429.
- **Subida segura da mesa**: credenciais, estrategia, workers, intervalo e timeout.

## Exemplo seguro de `.env`

```env
ORG_REGION=sa_east_1
CLIENT_ID=seu_client_id_oauth
CLIENT_SECRET=seu_client_secret_oauth
QUEUE_IDS=queue-id-exemplo-1,queue-id-exemplo-2
CLEANUP_CONCURRENCY=10
CLEANUP_RATE_LIMIT_PER_MINUTE=280
CLEANUP_RATE_LIMIT_FALLBACK_SECONDS=30
CLEANUP_USE_UPLOAD_CREDENTIALS=0
CLEANUP_MAX_CREDENTIALS=6
INPUT_MESA_DIR=
LOG_DIR=
EXTRACAO_USUARIO=usuario_exemplo
EXTRACAO_SENHA=senha_exemplo
EXTRACAO_HEADLESS=1
EXTRACAO_BROWSER_CHANNEL=msedge
```
