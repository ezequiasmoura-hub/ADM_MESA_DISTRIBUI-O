# Documentacao Tecnica

## Visao geral

O projeto e uma aplicacao Electron com processo principal em `main.js`, interface em `index.html` e bridge segura em `preload.js`. A aplicacao concentra tres fluxos principais:

- extrair bases operacionais;
- gerar CSV de insercao na mesa;
- consultar e limpar conversas da mesa no Genesys.

O codigo atual privilegia compatibilidade operacional. Por isso, `main.js` ainda concentra muitas responsabilidades. Refatoracoes devem ser feitas com cuidado e com testes de regressao contra bases reais/exportadas do BI.

## Arquitetura

```text
index.html
  UI, filtros, tabelas, progresso, configuracoes

preload.js
  expoe window.api via contextBridge

main.js
  IPC handlers
  configuracao
  Genesys SDK
  leitura de bases
  geracao CSV
  limpeza
  extracoes
  execucao de MesaDistribuicao.py/.exe

scripts/extracao/
  extratores JavaScript chamados pela UI e por npm scripts
```

## Principais arquivos

- `main.js`: autentica no Genesys, consulta filas, gera CSV, limpa conversas, executa scripts de extracao e executa o processo de subida.
- `preload.js`: disponibiliza chamadas IPC como `gerarBase`, `listarMesa`, `limparMesa`, `runExtracao` e eventos de progresso.
- `index.html`: contem CSS, HTML e JS da interface.
- `scripts/extracao/shared.js`: utilitarios dos extratores, carregamento de `.env`, login e escrita CSV.
- `scripts/extracao/site-novo.js`: baixa os XLS `01_Todos_Aberto.xls` e `02_Todos_Pendente.xls`.
- `scripts/extracao/site-antigo.js`: gera `bko_all.csv`.
- `scripts/extracao/go.js`: gera `EQTL_GO.csv`.
- `scripts/extracao/rs.js`: gera `EQTL_RS.csv`.
- `inputMesa/MesaDistribuicao.py`: script externo preferencial para subir a mesa quando existir. Este arquivo e local/sensivel e nao deve ser versionado enquanto contiver credenciais.
- `inputMesa/MesaDistribuicao.exe`: fallback externo de subida.

## IPC exposto para a UI

`preload.js` expoe:

- `getConfig` / `setConfig`;
- `pickFile`, `pickFiles`, `pickFolder`;
- `gerarBase`;
- `executarMesa`;
- `openOutput`;
- `listarMesa`;
- `limparMesa`;
- `runExtracao`;
- `testGenesys`;
- `startAuto` / `stopAuto`;
- eventos `progress`, `auto-trigger`, `genesys-status`, `extraction-log`, `cleanup-progress`.

## Configuracao

Os defaults estao em `CONFIG` dentro de `main.js`. A ordem de carregamento e:

1. `.env` na raiz;
2. `inputMesa/.env`;
3. arquivo salvo pela UI em `app.getPath('userData')/mesa_config.json`;
4. normalizacao em `normalizeConfigAfterLoad()`.

Credenciais vazias salvas pela UI nao sobrescrevem `CLIENT_ID`, `CLIENT_SECRET` e `ORG_REGION`.

## Integracao Genesys

A autenticacao usa:

```js
client.loginClientCredentialsGrant(CONFIG.CLIENT_ID, CONFIG.CLIENT_SECRET)
```

A regiao vem de:

```js
platformClient.PureCloudRegionHosts[CONFIG.ORG_REGION]
```

O padrao para Brasil e `sa_east_1`.

Principais APIs usadas:

- `AnalyticsApi.postAnalyticsConversationsActivityQuery`
- `AnalyticsApi.postAnalyticsConversationsDetailsQuery`
- `AnalyticsApi.getAnalyticsConversationDetails`
- `ConversationsApi.getConversation`
- `ConversationsApi.postConversationDisconnect`

O script externo de subida, quando usado, faz POST em `/api/v2/conversations/emails`.

## Consulta da mesa

`consultarMesaGenesys()` monta a query por filas em `buildMesaActivityQuery()`. A query considera:

- `queueId` em lista;
- `mediaType=email`;
- metrica `oWaiting`;
- agrupamento por `conversationId` e `queueId`.

Modos:

- `protocolOnly=true`: usado na geracao de CSV para obter apenas protocolos e deduplicar rapidamente.
- `includeDetails=false`: usado antes de limpar selecionados, para validar se os IDs ainda estao na mesa.
- `includeDetails=true`: usado na aba de limpeza para montar a tabela completa.

Quando faltam detalhes, a aplicacao cruza a mesa com as bases locais para preencher tipo, estado, prazo, status, data, origem e skill.

## Geracao de CSV

`gerarBaseCompleta(filtros)` executa:

1. consulta rapida ao Genesys para montar `protocolosNaMesa`;
2. leitura da planilha de priorizacao;
3. leitura dos XLS do Site Novo;
4. leitura de `EQTL_RS.csv`, `EQTL_GO.csv` e `bko_all.csv`;
5. normalizacao de protocolo, empresa, servico e prazo;
6. filtros da UI;
7. remocao de duplicados ja presentes na mesa;
8. ordenacao por prioridade;
9. escrita de `inputMesa/mesa_distribuicao.csv`.

O header do CSV e definido em `CSV_HEADER_MESA`:

```text
Regiao;Nota;Conclusao_desejada;Mandante;Protocolo;Tipo_de_servico;Coluna;Dados;Skill;Fluxo;Prioridade;STATUS_PRAZO_MESA
```

## Filtros da geracao

Estado:

- MA, PA, PI, AL, GO, CEA, CEEE, CSA.

SLA:

- `passivo`: `0-PASSIVO`;
- `hoje`: `1-VENCE HOJE`;
- `amanha`: qualquer `2-VENCE D+N`.

Outros:

- responsavel;
- site/origem;
- skill;
- tipo de servico;
- e-mail/dominio.

Skills e tipos de servico sao dinamicos e aparecem apos uma geracao.

## Limpeza

O fluxo principal esta em `ipcMain.handle('limpar-mesa')`.

Modos:

- `selected`: limpa IDs selecionados pela UI.
- `queueIds`: permitido somente sem filtros ou apenas com filtro de estado. A aplicacao consulta os IDs de fila configurados e monta a fila no momento da limpeza.

Confirmacao:

- a UI sempre exibe `confirm()`;
- o backend exige `confirmText === 'LIMPAR'`;
- se a confirmacao estiver ausente ou invalida, a limpeza nao roda e um log de falha e gerado.

## Rate limiter global

O rate limiter esta em `createCleanupRateLimiter()`.

Ele usa:

- `CLEANUP_RATE_LIMIT_PER_MINUTE`, default `280`, maximo normalizado `300`;
- intervalo calculado `Math.ceil(60000 / rpm)`;
- uma cadeia `turnChain` para serializar o inicio das chamadas;
- pausa global compartilhada quando recebe `429`.

Esse desenho garante que o paralelismo nao ultrapasse o limite global de chamadas iniciadas por minuto.

## Paralelismo

`disconnectConversationsControlled()` usa `mapLimit()` com `CLEANUP_CONCURRENCY`.

O paralelismo controla quantas conversas podem estar em execucao simultanea. Antes de cada chamada de desconexao, o worker precisa passar pelo rate limiter global.

Padroes:

- `CLEANUP_CONCURRENCY=10`;
- `CLEANUP_RATE_LIMIT_PER_MINUTE=280`;
- `CLEANUP_RATE_LIMIT_FALLBACK_SECONDS=30`.

## Retry e backoff

`disconnectConversationSafe()`:

- tenta a chamada `postConversationDisconnect`;
- se receber `429`, chama `limiter.pauseFrom429()` e repete a mesma conversa;
- se receber `408`, `500`, `502`, `503` ou `504`, tenta novamente com pequeno backoff;
- depois das tentativas, retorna falha para aquela conversa.

O `429` nao consome a conversa como erro final. Ela volta para tentativa depois da pausa.

## Controle de progresso

Durante a limpeza, `emitCleanupProgress()` envia eventos para a UI:

- total;
- processadas;
- sucesso;
- erro;
- pendentes;
- paralelo;
- req/min;
- status;
- contagem de rate limit.

Esse progresso e mantido em memoria. Nao ha checkpoint persistente para retomada depois de fechar o app.

## Logs

- Limpeza: `logs/limpeza-mesa-AAAA-MM-DD.jsonl`.
- Extracoes: `logs/extracoes/<id>_<timestamp>.log`.
- Subida Python: quando executada diretamente, pode gerar `inputMesa/logs_*.txt`.

Logs de extracao passam por `sanitizeProcessOutput()`, que mascara `CLIENT_ID`, `CLIENT_SECRET`, credenciais de extracao e bearer tokens conhecidos.

## Extracoes

`runExtractionScript(id)` executa cada script com `spawn`, `shell:false`, runtime Node por padrao, variaveis de ambiente especificas e logs sanitizados.

Scripts:

- `siteNovo` -> `scripts/extracao/site-novo.js`;
- `siteAntigo` -> `scripts/extracao/site-antigo.js`;
- `go` -> `scripts/extracao/go.js`;
- `rs` -> `scripts/extracao/rs.js`.

O botao **Rodar 4 scripts** executa todos em sequencia.

## Subida da mesa

`executar-mesa` procura:

1. `inputMesa/MesaDistribuicao.py`;
2. se nao existir, `inputMesa/MesaDistribuicao.exe`.

Se usar Python, executa:

```text
python -X utf8 inputMesa/MesaDistribuicao.py
```

O app injeta:

- `PYTHONIOENCODING=utf-8`;
- `PYTHONUTF8=1`;
- `MESA_UPLOAD_STRATEGY`;
- `MESA_UPLOAD_WORKERS`;
- `MESA_UPLOAD_INTERVAL_SECONDS`;
- `MESA_UPLOAD_BATCH_PAUSE_SECONDS`.

## Debug

Comandos uteis:

```powershell
npm run check
npm start
npm run extract:site-novo
npm run extract:site-antigo
npm run extract:go
npm run extract:rs
```

Para investigar limpeza:

1. consultar `logs/limpeza-mesa-AAAA-MM-DD.jsonl`;
2. confirmar `QUEUE_IDS` e `CLEANUP_QUEUE_IDS`;
3. testar Genesys pela UI;
4. reduzir `CLEANUP_RATE_LIMIT_PER_MINUTE` se houver muito `429`;
5. validar se as bases locais estao atualizadas para enriquecer a tabela.

## Adicionar funcionalidades

Recomendacoes:

- manter qualquer acao destrutiva no `main.js`, nunca diretamente no frontend;
- exigir confirmacao explicita;
- gerar log;
- nao logar tokens ou secrets;
- usar `preload.js` para expor somente IPC necessario;
- preservar `contextIsolation: true` e `nodeIntegration: false`;
- criar configuracoes novas em `CONFIG`, UI e `.env.example`;
- rodar `npm run check`.

## Cuidados com credenciais

Nao versionar:

- `.env`;
- `inputMesa/.env`;
- logs;
- CSVs gerados;
- executaveis;
- scripts com client secret embutido.

O arquivo local `inputMesa/MesaDistribuicao.py` encontrado no ambiente contem credenciais embutidas. Ele deve ser tratado como artefato sensivel e refatorado antes de qualquer commit de codigo-fonte operacional.
