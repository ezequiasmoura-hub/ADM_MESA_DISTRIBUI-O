# Configuracoes

Este documento explica as variaveis de ambiente e as configuracoes da tela **Configuracoes**.

## Arquivos de configuracao

A aplicacao carrega:

1. `.env` na raiz do projeto;
2. `inputMesa/.env`;
3. configuracoes salvas pela UI em `mesa_config.json` na pasta de dados do usuario do Electron.

Use `.env.example` como modelo. Nao commite `.env`.

## Genesys

### `ORG_REGION`

Chave do enum `PureCloudRegionHosts`.

Exemplo:

```env
ORG_REGION=sa_east_1
```

### `CLIENT_ID`

Client ID OAuth Client Credentials.

Exemplo seguro:

```env
CLIENT_ID=seu_client_id_oauth
```

### `CLIENT_SECRET`

Client secret OAuth. Nunca versionar.

Exemplo seguro:

```env
CLIENT_SECRET=seu_client_secret_oauth
```

### `QUEUE_ID` e `QUEUE_IDS`

Filas monitoradas para consulta geral e deduplicacao.

Exemplo:

```env
QUEUE_IDS=queue-id-al,queue-id-go
```

`QUEUE_ID` singular tambem e aceito pelo codigo como fallback.

## Limpeza

### `CLEANUP_CONCURRENCY`

Quantidade de conversas processadas em paralelo.

Padrao:

```env
CLEANUP_CONCURRENCY=10
```

Na UI aparece como **paralelo**.

### `CLEANUP_RATE_LIMIT_PER_MINUTE`

Limite global de chamadas de limpeza iniciadas por minuto.

Padrao:

```env
CLEANUP_RATE_LIMIT_PER_MINUTE=280
```

A normalizacao atual limita o valor a `300`.

### `CLEANUP_RATE_LIMIT_FALLBACK_SECONDS`

Tempo de espera quando a Genesys retorna `429` sem header `Retry-After`.

Padrao:

```env
CLEANUP_RATE_LIMIT_FALLBACK_SECONDS=30
```

Na UI aparece como **429/s**.

### `CLEANUP_QUEUE_IDS`

IDs de fila usados quando a limpeza estiver sem filtros ou apenas com filtro de estado.

Exemplo:

```env
CLEANUP_QUEUE_IDS=queue-id-al,queue-id-go
```

Tambem pode ser configurado na UI, um ID por linha.

### `CLEANUP_START_INTERVAL_MS`

Configuracao legada ainda lida pelo codigo, mas a UI atual usa o rate limiter por minuto. Nao deve ser usada em operacao normal.

## Consulta de protocolos da mesa

### `MESA_DETAIL_RETRIES`

Quantidade de tentativas para leitura detalhada de conversa em rotinas que usam retry detalhado.

Padrao:

```env
MESA_DETAIL_RETRIES=30
```

Valor `0` significa sem limite pratico, mas deve ser usado com cuidado.

### `MESA_DETAIL_RETRY_DELAY_MS`

Espera entre tentativas detalhadas.

```env
MESA_DETAIL_RETRY_DELAY_MS=1500
```

### `MESA_PROTOCOL_CONCURRENCY`

Concorrencia do fallback analitico individual quando a consulta em lote nao encontra protocolo.

```env
MESA_PROTOCOL_CONCURRENCY=12
```

### `MESA_PROTOCOL_INTERVAL_DAYS`

Janela, em dias, usada nas consultas analiticas de detalhes.

```env
MESA_PROTOCOL_INTERVAL_DAYS=30
```

A normalizacao limita internamente a janela de consulta a ate 31 dias.

## Subida da mesa

Essas variaveis sao passadas para `inputMesa/MesaDistribuicao.py` quando o app executa a subida.

### `MESA_UPLOAD_STRATEGY`

Estrategia:

- `paced`: ritmo continuo;
- `batch`: lotes;
- `serial`: uma por vez.

Padrao:

```env
MESA_UPLOAD_STRATEGY=paced
```

### `MESA_UPLOAD_WORKERS`

Quantidade de workers da subida.

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

Pausa entre lotes no modo `batch`.

```env
MESA_UPLOAD_BATCH_PAUSE_SECONDS=2
```

### `MESA_UPLOAD_TIMEOUT_MINUTES`

Timeout do processo externo de subida. `0` significa sem timeout imposto pelo Electron.

```env
MESA_UPLOAD_TIMEOUT_MINUTES=0
```

## Retry do script Python de subida

Essas variaveis sao usadas pelo `inputMesa/MesaDistribuicao.py`.

```env
MESA_REQUEST_RETRIES=8
MESA_REQUEST_TIMEOUT_SECONDS=25
MESA_RATE_LIMIT_SLEEP_SECONDS=30
MESA_TOKEN_RETRIES=8
MESA_TOKEN_RETRY_SECONDS=15
MESA_DRY_RUN=0
```

`MESA_DRY_RUN=1` testa o script de subida sem criar conversas.

## Extracoes

### Credenciais gerais

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

Se a credencial especifica existir, ela tem prioridade sobre a geral.

### `EXTRACAO_HEADLESS`

Controla navegador visivel dos extratores.

```env
EXTRACAO_HEADLESS=1
```

Use `0` para abrir navegador visivel durante diagnostico.

### `EXTRACAO_BASE_DIR`

Pasta base onde os extratores salvam os arquivos.

```env
EXTRACAO_BASE_DIR=H:\TEMOTEO - NAO ABRA\Base
```

### Site Novo

```env
EXTRACAO_SITE_NOVO_CDP=0
EXTRACAO_SITE_NOVO_RETRY_MS=30000
EXTRACAO_SITE_NOVO_MAX_TENTATIVAS=3
EXTRACAO_SITE_NOVO_START_DATE=2026-01-01
```

- `CDP=1` conecta em navegador ja aberto na porta 9222.
- `START_DATE` define inicio do periodo exportado.

### Concorrencia HTTP dos extratores

```env
EXTRACAO_ANTIGO_CONCORRENCIA=50
EXTRACAO_GO_CONCORRENCIA=100
EXTRACAO_RS_CONCORRENCIA=100
```

## Runtime

### `NODE_BIN`

Runtime usado para scripts Node.

```env
NODE_BIN=node
```

### `PYTHON_BIN`

Runtime usado para `MesaDistribuicao.py`.

```env
PYTHON_BIN=python
```

## Configuracoes da tela

### Interface

- **Modo claro**: alterna tema claro/escuro.

### Arquivo de priorizacao

- Caminho da planilha `PRIORIZACAO_MESA_BKO.xlsx`.
- A aba esperada e `CONSOLIDADO`.

### Bases CSV

- `EQTL_RS.csv`;
- `EQTL_GO.csv`;
- `bko_all.csv`.

### Bases XLS Site Novo

- `01_Todos_Aberto.xls`;
- `02_Todos_Pendente.xls`.

### Credenciais das extracoes

Campos de usuario/senha para Site Novo, Site Antigo, GO e RS. Senha vazia na tela preserva a senha ja salva.

### Genesys Cloud

- `ORG_REGION`;
- `CLIENT_ID`;
- `CLIENT_SECRET`;
- `QUEUE_IDs`;
- IDs da mesa para limpeza;
- teste de conexao.

### Velocidade da limpeza

- **paralelo** -> `CLEANUP_CONCURRENCY`;
- **req/min** -> `CLEANUP_RATE_LIMIT_PER_MINUTE`;
- **429/s** -> `CLEANUP_RATE_LIMIT_FALLBACK_SECONDS`.

### Subida segura da mesa

- estrategia;
- workers;
- intervalo;
- timeout.

## Exemplo seguro de `.env`

```env
ORG_REGION=sa_east_1
CLIENT_ID=seu_client_id_oauth
CLIENT_SECRET=seu_client_secret_oauth
QUEUE_IDS=queue-id-exemplo-1,queue-id-exemplo-2
CLEANUP_CONCURRENCY=10
CLEANUP_RATE_LIMIT_PER_MINUTE=280
CLEANUP_RATE_LIMIT_FALLBACK_SECONDS=30
EXTRACAO_USUARIO=usuario_exemplo
EXTRACAO_SENHA=senha_exemplo
EXTRACAO_HEADLESS=1
```
