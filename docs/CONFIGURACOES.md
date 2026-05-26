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

## Pastas locais

### `INPUT_MESA_DIR`

Pasta onde ficam o CSV final e o executor externo da subida.

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

Limite global de requisicoes de limpeza iniciadas por minuto.

```env
CLEANUP_RATE_LIMIT_PER_MINUTE=280
```

Padrao: `280`. A normalizacao limita a no maximo `300`.

### `CLEANUP_RATE_LIMIT_FALLBACK_SECONDS`

Tempo de espera quando a Genesys retorna `429` sem `Retry-After`.

```env
CLEANUP_RATE_LIMIT_FALLBACK_SECONDS=30
```

### `CLEANUP_QUEUE_IDS`

IDs de fila usados pela limpeza por estado/fila quando nao ha filtros detalhados.

```env
CLEANUP_QUEUE_IDS=queue-id-al,queue-id-go
```

Na UI, informe um ID por linha.

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

Essas variaveis sao passadas para `MesaDistribuicao.py` quando a UI executa a subida externa.

### `MESA_UPLOAD_STRATEGY`

```env
MESA_UPLOAD_STRATEGY=paced
```

Valores:

- `paced`;
- `batch`;
- `serial`.

### `MESA_UPLOAD_WORKERS`

Quantidade de workers da subida externa.

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

### Variaveis do script Python

```env
MESA_REQUEST_RETRIES=8
MESA_REQUEST_TIMEOUT_SECONDS=25
MESA_RATE_LIMIT_SLEEP_SECONDS=30
MESA_TOKEN_RETRIES=8
MESA_TOKEN_RETRY_SECONDS=15
MESA_DRY_RUN=0
```

`MESA_DRY_RUN=1` deve ser usado somente para diagnostico do script externo.

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

### `EXTRACAO_HEADLESS`

```env
EXTRACAO_HEADLESS=1
```

Use `0` para diagnostico com navegador visivel.

### `EXTRACAO_BASE_DIR`

Pasta onde os extratores salvam bases.

```env
EXTRACAO_BASE_DIR=C:\Bases\Mesa
```

### Site Novo

```env
EXTRACAO_SITE_NOVO_CDP=0
EXTRACAO_SITE_NOVO_RETRY_MS=30000
EXTRACAO_SITE_NOVO_MAX_TENTATIVAS=3
EXTRACAO_SITE_NOVO_START_DATE=2026-01-01
```

### Concorrencia dos extratores

```env
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

### `PYTHON_BIN`

Runtime usado para `MesaDistribuicao.py`.

```env
PYTHON_BIN=python
```

## Configuracoes da tela

- **Modo claro**: alterna tema.
- **Pastas locais**: define `INPUT_MESA_DIR` e `LOG_DIR`.
- **Bases**: caminhos das planilhas/CSVs usados para gerar a mesa.
- **Credenciais de extracao**: usuario/senha por origem.
- **Genesys Cloud**: regiao, client id, client secret e filas.
- **Velocidade da limpeza**: paralelo, req/min e fallback 429.
- **Subida segura da mesa**: estrategia, workers, intervalo e timeout.

## Exemplo seguro de `.env`

```env
ORG_REGION=sa_east_1
CLIENT_ID=seu_client_id_oauth
CLIENT_SECRET=seu_client_secret_oauth
QUEUE_IDS=queue-id-exemplo-1,queue-id-exemplo-2
CLEANUP_CONCURRENCY=10
CLEANUP_RATE_LIMIT_PER_MINUTE=280
CLEANUP_RATE_LIMIT_FALLBACK_SECONDS=30
INPUT_MESA_DIR=
LOG_DIR=
EXTRACAO_USUARIO=usuario_exemplo
EXTRACAO_SENHA=senha_exemplo
EXTRACAO_HEADLESS=1
```
