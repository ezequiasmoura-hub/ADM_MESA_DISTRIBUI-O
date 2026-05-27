# Fluxo de Limpeza da Mesa

Este documento descreve o processo de limpeza implementado na aplicacao.

## Objetivo

Remover da mesa do Genesys somente as conversas/protocolos que o usuario confirmou, respeitando filtros, filas, rate limit, logs e progresso.

## Fluxo passo a passo

1. Usuario abre **Limpeza da Mesa**.
2. A UI chama `listar-mesa`.
3. O backend consulta o Genesys.
4. A UI mostra as conversas em tabela.
5. Usuario aplica filtros.
6. Usuario seleciona itens ou usa o modo por ID da mesa.
7. Usuario clica no botao de limpeza.
8. UI mostra confirmacao com quantidade e estados.
9. Backend valida a confirmacao.
10. Backend monta a fila de `conversationId`.
11. Backend desconecta cada conversa respeitando paralelismo e rate limit.
12. Backend grava log JSONL.
13. UI mostra resultado e atualiza a mesa.

## Consulta da mesa

A consulta inicial usa `consultarMesaGenesys({ includeDetails: true })`.

A aplicacao busca conversas com:

- filas configuradas;
- `mediaType=email`;
- metrica `oWaiting`;
- agrupamento por `conversationId` e `queueId`.

Depois, tenta preencher:

- protocolo;
- tipo de servico;
- empresa;
- prazo;
- status;
- data;
- origem;
- skill;
- fila.

Quando os detalhes do Genesys nao trazem tudo, a aplicacao cruza os protocolos com as bases locais para enriquecer a tabela.

## Limpar tratados fora

A acao **Limpar tratados fora** consulta a mesa e cruza os protocolos atuais com as bases de origem configuradas.

Regras:

- somente protocolos identificados entram na comparacao;
- protocolos sem numero sao ignorados;
- se o protocolo ainda existir nas bases atuais e for elegivel para a base de distribuicao, ele nao e limpo;
- se o protocolo esta na mesa e nao existe nas bases atuais, ele entra como candidato;
- se o protocolo existe na origem, mas pertence a tipo de servico excluido da base de distribuicao, ele tambem entra como candidato;
- antes da limpeza real, a aplicacao mostra total, estados e pede confirmacao;
- a desconexao usa o mesmo fluxo seguro de limpeza por itens selecionados.

## Filtros

Filtros disponiveis:

- busca livre;
- empresa/estado;
- prazo;
- status;
- tipo de servico.

Os filtros ficam no frontend e atuam sobre os registros ja carregados na tabela.

## Montagem da fila

Existem dois modos.

### Modo selecionados

Usado quando ha filtros detalhados, como prazo, status, tipo de servico ou busca.

Fluxo:

1. UI envia `conversationIds` selecionados.
2. Backend consulta a mesa com `includeDetails=false`.
3. Backend remove da fila IDs que nao estao mais na mesa.
4. IDs restantes entram em `disconnectConversationsControlled()`.

Esse modo limpa somente os itens selecionados.

### Modo por ID da mesa

Usado quando:

- nao ha filtros; ou
- ha somente filtro de empresa/estado.

Fluxo:

1. UI faz uma pre-consulta com `dryRun=true` para contar as conversas nas filas.
2. UI mostra total, estados e IDs de fila.
3. Usuario confirma.
4. Backend consulta os `queueId` configurados em tempo real.
5. Todos os `conversationId` encontrados entram na fila.

Nesse modo, a selecao manual da tabela e ignorada. A confirmacao informa isso ao usuario.

## Processamento de cada item

Cada item da fila e um `conversationId`.

Para cada item:

1. worker pede permissao ao rate limiter global;
2. rate limiter aguarda a vez da chamada;
3. backend chama `postConversationDisconnect(conversationId)`;
4. se a chamada retorna sucesso, o contador de sucesso aumenta;
5. se retorna erro final, a falha e registrada para aquele ID.

## Sucesso

Quando uma conversa e limpa com sucesso:

- o resultado fica `{ ok: true, conversationId }`;
- o contador **Sucesso** aumenta;
- o contador **Processadas** aumenta;
- o contador **Pendentes** diminui.

Ao final, a quantidade de sucesso vira `removed` na resposta.

## Erro

Quando ocorre erro nao recuperavel:

- a conversa nao e repetida indefinidamente;
- a falha e registrada com `conversationId`, mensagem e status HTTP quando disponivel;
- o contador **Erro** aumenta;
- o processo continua com as demais conversas.

Erros transitorios `408`, `500`, `502`, `503` e `504` recebem tentativas curtas antes de virar falha.

## Rate limit 429

Quando o Genesys responde `429`:

1. a conversa atual nao e marcada como erro final;
2. a aplicacao le o header `Retry-After`;
3. se o header existir, usa esse tempo;
4. se nao existir, usa `CLEANUP_RATE_LIMIT_FALLBACK_SECONDS`, padrao `30`;
5. a pausa e global para a fila inteira;
6. a UI mostra contagem regressiva;
7. ao terminar a pausa, a mesma conversa e tentada novamente;
8. a fila continua automaticamente.

Mensagem esperada:

```text
Rate limit atingido. Aguardando X segundos para continuar...
```

Nao e necessario Ctrl+C, reiniciar ou clicar novamente.

## Rate limiter global

O controle correto e por requisicoes por minuto, nao por pausa fixa a cada quantidade de protocolos.

Configuracoes:

- `CLEANUP_RATE_LIMIT_PER_MINUTE=280` por padrao;
- maximo normalizado `300`;
- intervalo automatico `60000 / reqPorMinuto`;
- `CLEANUP_CONCURRENCY=10` por padrao.

Mesmo com paralelo alto, uma chamada so inicia quando o rate limiter libera.

## Como evita repetir protocolos ja processados

Dentro da mesma execucao:

- cada `conversationId` entra uma vez na lista;
- `mapLimit()` distribui os indices sem duplicar;
- se houver `429`, a mesma chamada e repetida antes de concluir o item;
- itens que ja retornaram sucesso nao voltam para a fila;
- itens com falha ficam na lista de falhas.

Se o app for fechado, nao existe checkpoint persistido. A operacao segura e consultar a mesa novamente, porque conversas removidas com sucesso nao devem mais aparecer.

## Logs

Cada limpeza grava um JSON por linha em:

```text
<pasta-de-logs>/limpeza-mesa-AAAA-MM-DD.jsonl
```

Campos principais:

- `timestamp`;
- `action`;
- `cleanupMode`;
- `filtros`;
- `queueModeInfo`;
- `totalSelecionado`;
- `conversationIds`;
- `protocolos`;
- `sucesso`;
- `removidos`;
- `ignorados`;
- `falhas`.

## Resumo final

No final da limpeza:

- **removidos**: sucesso real na API;
- **falhas**: erros retornados ou excecoes por conversa;
- **ignorados**: IDs selecionados que nao estavam mais na mesa;
- **pendentes**: deve ficar zero quando o fluxo termina.

Se houver falhas, consulte o log e reabra/atualize a aba para verificar se os protocolos ainda estao na mesa.
