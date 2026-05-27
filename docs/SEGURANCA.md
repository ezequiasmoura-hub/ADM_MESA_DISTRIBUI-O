# Seguranca

Este documento descreve os cuidados de seguranca aplicados e os pontos que exigem atencao antes de operar ou distribuir a aplicacao.

## Principios

- A interface nao deve ter acesso direto ao Node.js.
- Credenciais nao devem aparecer no frontend, console ou logs.
- Qualquer acao destrutiva deve exigir confirmacao.
- O app deve operar perto do limite da Genesys sem ultrapassar de forma intencional.
- Arquivos sensiveis e gerados nao devem ser versionados.

## Electron

Configuracoes aplicadas em `BrowserWindow`:

```js
contextIsolation: true
nodeIntegration: false
webSecurity: true
allowRunningInsecureContent: false
```

Tambem foram aplicados:

- bloqueio de novas janelas com `setWindowOpenHandler`;
- bloqueio de navegacao externa com `will-navigate`;
- DevTools desabilitado quando o app esta empacotado;
- acesso ao sistema operacional somente pelo processo principal;
- IPC controlado via `preload.js`.

## Renderer

O renderer recebe uma configuracao publica gerada por `createPublicConfig()`.

Campos sensiveis sao tratados assim:

- `CLIENT_SECRET` volta vazio para a UI;
- senhas de extracao voltam vazias;
- a UI recebe apenas flags como `CLIENT_SECRET_CONFIGURED`;
- se o usuario deixar senha vazia ao salvar, o valor anterior e preservado.

## IPC

O `preload.js` expoe apenas os canais necessarios para a operacao:

- configuracao;
- selecao de arquivos/pastas;
- geracao de CSV;
- consulta e limpeza;
- extracoes;
- teste Genesys;
- modo automatico;
- progresso.

Novos canais devem ser adicionados somente quando houver necessidade real e com validacao no `main.js`.

## Genesys

A autenticacao usa OAuth Client Credentials:

```text
CLIENT_ID
CLIENT_SECRET
ORG_REGION
```

Cuidados:

- nao colocar secrets em `index.html`;
- nao logar bearer token;
- nao enviar secret para o renderer;
- validar permissao `conversation:communication:disconnect` antes de operar limpeza;
- tratar `401`, `403`, `429`, `500` e `503` com mensagens claras.

## Limpeza segura

Protecoes atuais:

- limpeza nao roda ao abrir tela;
- exige clique do usuario;
- exige confirmacao com texto `LIMPAR`;
- backend valida a confirmacao;
- modo selecionado limpa somente IDs selecionados;
- modo por fila/estado so roda quando nao ha filtros detalhados ou ha apenas filtro de estado;
- progresso e erros sao registrados;
- rate limiter global impede ritmo acima do configurado;
- `429` pausa e continua automaticamente.

## Logs

Padrao no app empacotado:

```text
%APPDATA%/ADM Mesa de Distribuição/logs
```

Tipos:

- `app-AAAA-MM-DD.log`;
- `limpeza-mesa-AAAA-MM-DD.jsonl`;
- `extracoes/<id>_<timestamp>.log`.

Sanitizacao:

- tokens Bearer;
- `CLIENT_ID`;
- `CLIENT_SECRET`;
- senhas de extracao conhecidas;
- mensagens de processo externo antes de enviar para UI/log.

Mesmo assim, logs podem conter protocolos e informacoes operacionais. Trate-os como dados internos.

## Arquivos ignorados pelo Git

O `.gitignore` cobre:

- `node_modules/`;
- `dist/`;
- `build/`;
- `out/`;
- `.env`;
- logs;
- caches;
- CSVs e planilhas geradas;
- scripts/executaveis operacionais antigos de `inputMesa`;
- credenciais e tokens.

Antes de commitar, sempre rode:

```powershell
git status --short
```

## Configuracoes sensiveis

`.env.example` deve conter somente valores ficticios.

Nao documentar:

- bearer token real;
- client secret real;
- senha real;
- protocolo sensivel desnecessario;
- conteudo de logs com dados reais.

## Subida da mesa

A subida atual usa `scripts/mesa-upload.js`, empacotado com a aplicacao.

Regras:

- nao colocar credenciais dentro do script;
- preferir variaveis de ambiente;
- manter logs sanitizados;
- testar primeiro com CSV pequeno e validado.

## Build e distribuicao

O build gera `.exe` sem incluir `.env`, logs, bases ou executaveis operacionais sensiveis.

Para uma release oficial:

- usar certificado de assinatura digital;
- testar em maquina limpa;
- revisar artefatos com `git status`;
- conferir que `dist/` nao foi versionado;
- evitar publicar pacote com credenciais locais.

## Pendencias recomendadas

- Migrar secrets salvos para Windows Credential Manager.
- Adicionar Content Security Policy explicita no HTML.
- Modularizar IPC e validar schemas de entrada.
- Criar testes automatizados de sanitizacao de logs.
- Ativar `asar` com `asarUnpack` depois de validar extratores.
