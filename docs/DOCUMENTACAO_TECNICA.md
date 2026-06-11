# Documentacao Tecnica

## Visao geral

O projeto e uma aplicacao Electron que concentra tres fluxos principais:

- extrair bases operacionais;
- gerar `mesa_distribuicao.csv`;
- consultar e limpar conversas da mesa no Genesys Cloud.

O processo principal (`main.js`) atua como backend local via IPC. Nao ha servidor Express. A interface fica em `index.html` e recebe apenas uma API limitada por `preload.js`.

## Arquitetura atual

```text
index.html
  interface, filtros, cards, tabelas, configuracoes e progresso

preload.js
  bridge segura window.api

main.js
  janela Electron
  configuracao
  Genesys SDK
  geracao CSV
  limpeza
  extracoes
  subida JS integrada
  logs

scripts/extracao/
  extratores JavaScript chamados pela UI e por npm scripts

assets/
  icone e logo

electron-builder.yml
  build Windows
```

## Principais arquivos

- `main.js`: regras de negocio, IPC, Genesys, CSV, limpeza, extracoes, subida JS integrada e logs.
- `preload.js`: expoe `window.api` por `contextBridge`.
- `index.html`: UI desktop completa.
- `scripts/extracao/shared.js`: funcoes comuns dos extratores.
- `scripts/extracao/site-novo.js`: extrai XLS do Site Novo.
- `scripts/extracao/site-antigo.js`: gera `bko_all.csv`.
- `scripts/extracao/go.js`: gera `EQTL_GO.csv`.
- `scripts/extracao/rs.js`: gera `EQTL_RS.csv`.
- `electron-builder.yml`: empacotamento Windows.
- `assets/icon.ico`: icone usado pela janela/build.

## IPC

Canais principais expostos no `preload.js`:

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

Novos canais devem ser pequenos, validados no `main.js` e nunca expor Node diretamente ao renderer.

## Configuracao

A ordem de carga e:

1. defaults em `CONFIG`;
2. `.env` na raiz;
3. `inputMesa/.env`;
4. `.env` na pasta de dados do usuario;
5. `inputMesa/.env` na pasta de dados do usuario;
6. `mesa_config.json` salvo pela UI;
7. `normalizeConfigAfterLoad()`.

`createPublicConfig()` monta a versao enviada ao renderer. Essa versao nao inclui `CLIENT_SECRET` nem senhas de extracao em texto claro.

## Genesys

Autenticacao:

```js
client.loginClientCredentialsGrant(CONFIG.CLIENT_ID, CONFIG.CLIENT_SECRET)
```

Regiao:

```js
platformClient.PureCloudRegionHosts[CONFIG.ORG_REGION]
```

Principais APIs:

- `AnalyticsApi.postAnalyticsConversationsActivityQuery`;
- `AnalyticsApi.postAnalyticsConversationsDetailsQuery`;
- `AnalyticsApi.getAnalyticsConversationDetails`;
- `ConversationsApi.getConversation`;
- `ConversationsApi.postConversationDisconnect`.

## Consulta da mesa

`consultarMesaGenesys()` usa query por `queueId`, `mediaType=email`, metrica `oWaiting` e agrupamento por `conversationId`/`queueId`.

Modos:

- `protocolOnly=true`: usado na geracao do CSV para deduplicacao rapida.
- `includeDetails=false`: usado antes de limpar selecionados para validar se IDs ainda estao na mesa.
- `includeDetails=true`: usado na aba de limpeza para montar tabela com estado, tipo, prazo e dados auxiliares.

Quando a Genesys nao devolve todos os detalhes, a aplicacao cruza com as bases locais para enriquecer os registros.

## Geracao de CSV

`gerarBaseCompleta(filtros)`:

1. consulta protocolos atuais da mesa;
2. le planilha de priorizacao;
3. le XLS do Site Novo;
4. le `EQTL_RS.csv`, `EQTL_GO.csv` e `bko_all.csv`;
5. normaliza estado, protocolo, servico, skill, prazo e origem;
6. aplica filtros da UI;
7. remove protocolos ja presentes na mesa;
8. calcula resumos e distribuicao por estado;
9. grava `mesa_distribuicao.csv` em `getInputMesaDir()`.

Header:

```text
Regiao;Nota;Conclusao_desejada;Mandante;Protocolo;Tipo_de_servico;Coluna;Dados;Skill;Fluxo;Prioridade;STATUS_PRAZO_MESA
```

Na subida integrada, `Prioridade` e convertida para inteiro e enviada tanto nos atributos quanto no campo nativo `priority` da conversa. Assim, filas configuradas para pontuacao por prioridade podem respeitar a ordenacao calculada pela base.

## Extracoes

`runExtractionScript(id)` executa os scripts via `spawn`.

No desenvolvimento, usa `node` ou `NODE_BIN`. No app empacotado, quando `NODE_BIN` esta vazio, usa o proprio executavel com:

```env
ELECTRON_RUN_AS_NODE=1
```

O processo filho recebe `NODE_PATH` apontando para o `node_modules` empacotado, permitindo que scripts externos apontados na tela usem as mesmas dependencias do projeto. Antes do script, o app carrega `scripts/extracao/playwright-fallback.js` via `--require`; esse preload tenta Edge/Chrome quando o Chromium padrao do Playwright nao existe na maquina instalada.

A UI permite rodar os quatro extratores em concorrencia. Internamente, a execucao em lote usa `Promise.all()` sobre os IDs selecionados.

Site Antigo, GO e RS passam por validacao em `scripts/extracao/output-validation.js`. O orquestrador exige arquivo atualizado na tentativa atual, cabecalho compativel e ao menos uma linha de dados. Se o processo falhar ou a validacao reprovar, apenas aquele extrator aguarda `EXTRACTION_RETRY_DELAY_SECONDS` e reinicia; o fluxo automatico permanece bloqueado ate todas as bases ficarem validas. O padrao `EXTRACTION_MAX_ATTEMPTS=0` mantem retentativa ilimitada.

Logs de extracao ficam em:

```text
getLogDir('extracoes')
```

## Atualizacoes

O auto-update fica no processo principal (`main.js`) usando `electron-updater`.

Responsabilidades:

- `setupAutoUpdater()`: registra eventos do atualizador;
- `checkForUpdates()`: consulta GitHub Releases;
- `downloadUpdate()`: baixa a versao disponivel apos confirmacao do usuario;
- IPC `get-update-state`, `check-for-updates`, `download-update` e `install-update`: expostos ao renderer via `preload.js`;
- evento `update-status`: atualiza a barra inferior da interface.

O renderer nao recebe tokens nem acessa GitHub diretamente. A publicacao das releases e feita fora do app, via GitHub Releases ou `npm run release:github` com `GH_TOKEN` apenas no terminal de build.

## Limpeza

O fluxo principal esta no handler `limpar-mesa`.

Protecoes:

- exige `confirmText === 'LIMPAR'`;
- valida modo selecionado;
- no modo `selected`, usa somente IDs selecionados;
- no modo `queueIds`, consulta as filas autorizadas para o estado/mesa;
- `QUEUE_IDS` e `CLEANUP_QUEUE_IDS` respeitam apenas os IDs configurados; os IDs padrao de Varejo entram somente como fallback;
- filas fora do mapa padrao podem ser cadastradas como `ESTADO|id-da-fila` para o filtro por estado;
- nao repete sucesso ja processado durante a fila;
- registra erros por conversa.

Quando `CLEANUP_USE_UPLOAD_CREDENTIALS` esta ativo, a limpeza cria um pool com as credenciais de `MESA_UPLOAD_CREDENTIALS`. Nesse modo:

- as chamadas de disconnect usam REST direto (`GenesysRestService`), sem depender do singleton do SDK;
- cada credencial tem seu proprio `createCleanupRateLimiter()`;
- o limite `CLEANUP_RATE_LIMIT_PER_MINUTE` e aplicado por credencial;
- `429` pausa somente a credencial afetada;
- a tela recebe `credentialPoolSize` e `effectiveRateLimitPerMinute`.

A consulta detalhada da mesa tambem pode usar o mesmo pool para chamadas `GET /api/v2/conversations/{id}`, acelerando o enriquecimento de dados quando ha varias credenciais autorizadas.

## Rate limiter global

`createCleanupRateLimiter()` controla o inicio das chamadas de limpeza.

Parametros:

- `CLEANUP_RATE_LIMIT_PER_MINUTE`;
- `CLEANUP_RATE_LIMIT_FALLBACK_SECONDS`.

Mesmo com `CLEANUP_CONCURRENCY=10`, nenhuma chamada passa pelo limiter sem aguardar sua vez.

Em `429`:

1. le `Retry-After`;
2. se ausente, usa fallback;
3. emite status para UI;
4. pausa globalmente;
5. continua a mesma conversa depois da espera.

## Paralelismo

`disconnectConversationsControlled()` usa `mapLimit()` com `CLEANUP_CONCURRENCY`.

O paralelismo controla quantidade de conversas simultaneas; o rate limiter controla o total de requisicoes por minuto.

## Logs

Diretorio padrao:

```text
getLogDir()
```

Em desenvolvimento, se `LOG_DIR` nao estiver configurado, usa a pasta de dados do usuario do Electron. Em builds empacotados, tambem usa `app.getPath('userData')/logs`.

Tipos:

- aplicacao: `app-AAAA-MM-DD.log`;
- limpeza: `limpeza-mesa-AAAA-MM-DD.jsonl`;
- extracoes: `extracoes/<id>_<timestamp>.log`.

Logs passam por sanitizacao para esconder tokens, `CLIENT_SECRET`, `CLIENT_ID` e senhas conhecidas.

## Subida JS integrada

`executar-mesa` usa o runner empacotado:

```text
scripts/mesa-upload.js
```

O app copia o CSV gerado para `getInputMesaDir()`, executa o script com o mesmo runtime Node/Electron e injeta variaveis de ambiente para:

- credenciais Genesys;
- credenciais exclusivas de subida (`MESA_UPLOAD_CREDENTIALS`), quando configuradas;
- estrategia;
- workers;
- intervalo;
- pausa de lote;
- timeout;
- dry-run.

O script le `mesa_distribuicao.csv`, cria as conversas por `/api/v2/conversations/emails`, registra log JSONL em `getLogDir('upload')` e retorna erro se houver falhas de envio.

## Build desktop

Empacotador:

```text
electron-builder
```

Comandos:

```powershell
npm run build
npm run dist:win
```

Configuracao:

```text
electron-builder.yml
```

Saidas:

```text
dist/win-unpacked/
dist/*-Setup-x64.exe
dist/*-Portable-x64.exe
```

## Debug

Comandos uteis:

```powershell
npm run check
npm run smoke
npm start
npm run dist:win
npm run extract:site-novo
npm run extract:site-antigo
npm run extract:go
npm run extract:rs
```

## Cuidados ao alterar

- Manter a limpeza no `main.js`/processo principal.
- Nao colocar token ou secret no renderer.
- Testar consulta antes de limpeza real.
- Preservar `contextIsolation: true` e `nodeIntegration: false`.
- Atualizar `.env.example` quando criar configuracao nova.
- Atualizar docs quando mudar fluxo de build, limpeza ou API.
- Rodar `npm run check` antes de commit.

## Refatoracao recomendada

O codigo atual esta funcional, mas `main.js` deve ser dividido em modulos quando houver tempo de teste:

- `genesysService`;
- `mesaCsvService`;
- `cleanupService`;
- `extractionService`;
- `uploadService`;
- `configService`;
- `loggingService`;
- `rateLimiter`.

A prioridade e manter comportamento identico antes de melhorar a estrutura.
