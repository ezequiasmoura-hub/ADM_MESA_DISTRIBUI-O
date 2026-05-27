# Integracao com Genesys Cloud

Este documento descreve a integracao real usada no projeto.

## Biblioteca

A aplicacao Electron usa:

```text
purecloud-platform-client-v2
```

A subida da mesa usa o script JavaScript empacotado `scripts/mesa-upload.js`.

## Autenticacao

No app Electron, a autenticacao usa OAuth Client Credentials:

```js
client.loginClientCredentialsGrant(CONFIG.CLIENT_ID, CONFIG.CLIENT_SECRET)
```

A regiao e configurada por:

```js
client.setEnvironment(platformClient.PureCloudRegionHosts[CONFIG.ORG_REGION])
```

Para o Brasil, o valor usado no SDK e:

```env
ORG_REGION=sa_east_1
```

O token e gerenciado pelo SDK. O app nao deve imprimir bearer token, client secret ou senha.

## Endpoints usados pelo app

As rotas abaixo sao chamadas por meio do SDK Genesys.

### Consultar conversas aguardando na mesa

Metodo:

```text
POST /api/v2/analytics/conversations/activity/query
```

SDK:

```js
AnalyticsApi.postAnalyticsConversationsActivityQuery(body)
```

Uso:

- listar conversas por `queueId`;
- filtrar `mediaType=email`;
- buscar metrica `oWaiting`;
- agrupar por `conversationId` e `queueId`.

### Consultar detalhes em lote

Metodo:

```text
POST /api/v2/analytics/conversations/details/query
```

SDK:

```js
AnalyticsApi.postAnalyticsConversationsDetailsQuery(body)
```

Uso:

- buscar detalhes de conversas por `conversationId`;
- preencher protocolo e atributos quando disponiveis;
- reduzir chamadas individuais.

### Consultar detalhes analiticos individuais

Metodo:

```text
GET /api/v2/analytics/conversations/{conversationId}/details
```

SDK:

```js
AnalyticsApi.getAnalyticsConversationDetails(conversationId)
```

Uso:

- fallback quando o lote nao trouxe protocolo.

### Consultar conversa em tempo real

Metodo:

```text
GET /api/v2/conversations/{conversationId}
```

SDK:

```js
ConversationsApi.getConversation(conversationId)
```

Uso:

- enriquecer dados da aba de limpeza;
- tentar obter atributos da conversa atual.

### Desconectar conversa

Metodo:

```text
POST /api/v2/conversations/{conversationId}/disconnect
```

SDK:

```js
ConversationsApi.postConversationDisconnect(conversationId)
```

Uso:

- limpeza real da mesa.

Essa chamada e destrutiva para a operacao da mesa. Ela so deve ser executada apos filtro, selecao/consulta por fila e confirmacao.

## Endpoint usado pela subida JS da mesa

Quando a UI executa a subida, `scripts/mesa-upload.js` cria conversas de e-mail por:

```text
POST /api/v2/conversations/emails
```

As credenciais sao recebidas do processo principal por variaveis de ambiente. O script nao contem client secret fixo.

## Permissoes necessarias

As permissoes exatas dependem da configuracao do OAuth Client no Genesys, mas o client precisa conseguir:

- autenticar por Client Credentials;
- ler analytics de conversas;
- ler detalhes de conversas;
- consultar conversas em tempo real;
- desconectar conversas;
- criar conversas de e-mail, caso use a subida da mesa.

Se a consulta funcionar, mas a limpeza falhar com `403`, o client provavelmente nao tem permissao para desconectar.

## Tratamento de respostas

### Consulta

As respostas de analytics sao normalizadas para registros com:

- `conversationId`;
- `queueId`;
- `protocolo`;
- `empresa`;
- `tipoServico`;
- `prazo`;
- `status`;
- `data`;
- `origem`;
- `skill`.

Quando dados nao aparecem no Genesys, a aplicacao cruza com as bases locais para enriquecer a tabela.

### Limpeza

Cada `conversationId` retorna:

- sucesso: `{ ok: true, conversationId }`;
- falha: `{ ok: false, conversationId, msg, status }`.

Falhas nao interrompem a fila inteira, exceto erros gerais de autenticacao/configuracao.

## Codigos de erro principais

### 401 Unauthorized

Possiveis causas:

- `CLIENT_ID` ou `CLIENT_SECRET` incorreto;
- token expirado/invalidado;
- regiao errada.

Acao:

- testar conexao em **Configuracoes**;
- conferir `ORG_REGION`;
- conferir credenciais no `.env` ou na UI.

### 403 Forbidden

Possiveis causas:

- OAuth Client sem permissao para consultar ou desconectar;
- divisao/fila fora do escopo de permissao.

Acao:

- revisar roles/permissoes no Genesys;
- validar se o client pode desconectar conversas.

### 429 Too Many Requests

Causa:

- limite de requisicoes da Genesys atingido.

Tratamento implementado:

- nao encerra a limpeza;
- respeita `Retry-After`;
- se nao houver header, aguarda `CLEANUP_RATE_LIMIT_FALLBACK_SECONDS`;
- mostra contagem regressiva;
- retoma automaticamente a mesma conversa.

### 500 Internal Server Error

Causa:

- falha temporaria no lado da API ou instabilidade.

Tratamento:

- retry curto para a conversa;
- se persistir, registra falha e continua.

### 503 Service Unavailable

Causa:

- indisponibilidade temporaria ou sobrecarga.

Tratamento:

- retry curto para a conversa;
- se persistir, registra falha e continua.

## Rate limit

O app usa `CLEANUP_RATE_LIMIT_PER_MINUTE` como limite global para desconexao. O padrao e `280`, com maximo normalizado `300`.

`CLEANUP_CONCURRENCY` nao substitui o rate limit. Mesmo com varios workers, toda chamada precisa passar pelo rate limiter.

## Seguranca

- Nunca colocar `CLIENT_SECRET`, bearer token ou senha na documentacao.
- Nunca versionar `.env`.
- Nao imprimir tokens no console.
- Logs de extracao passam por sanitizacao.
- Logs de limpeza registram IDs e protocolos afetados, mas nao tokens.
- Scripts externos com credenciais embutidas devem ser tratados como sensiveis e ignorados no Git.
