# ADM Mesa de Distribuição

Aplicacao desktop Electron para gerar a base `mesa_distribuicao.csv`, consultar a mesa de protocolos no Genesys Cloud, remover duplicidades antes da insercao e executar limpeza controlada da mesa com rate limit, paralelismo e logs.

O projeto foi preparado para empacotamento Windows com `electron-builder`, gerando instalador e versao portable em `.exe`.

## Objetivo

- Gerar o CSV operacional no padrao da aba `MESA DE DISTRIBUICAO` do BI.
- Consultar a mesa atual do Genesys antes de gerar a base e remover protocolos ja existentes.
- Rodar os extratores Site Novo, Site Antigo, GO e RS/CEEE em JavaScript.
- Permitir modo automatico: extrair bases, gerar CSV respeitando os filtros da tela e executar a subida externa da mesa.
- Consultar e limpar conversas da mesa com confirmacao, controle de ritmo e auditoria.

## Funcionalidades principais

- Tela **Gerar Base** com filtros por estado, SLA, responsavel, origem/site, skill, tipo de servico e e-mail.
- Botoes **todos** e **limpar** nos filtros de multiselecao.
- Cards de resumo da base e distribuicao por estado.
- Geracao fixa de `mesa_distribuicao.csv`, com separador `;` e UTF-8 com BOM.
- Deduplicacao contra protocolos ja presentes na mesa do Genesys.
- Tela **Extrair Bases** com execucao individual ou concorrente dos quatro extratores.
- Tela **Limpeza da Mesa** com filtros multiselecao, selecao manual e confirmacao.
- Limpeza por itens selecionados ou, quando aplicavel, por ID de fila/estado.
- Rate limiter global configuravel, padrao `280` requests/min e maximo operacional `300`.
- Paralelismo configuravel, padrao `10`.
- Retry automatico em `429`, respeitando `Retry-After` e fallback de `30` segundos.
- Logs locais de aplicacao, extracao e limpeza.
- Modo claro/escuro.
- Build Windows com instalador NSIS e portable `.exe`.

## Tecnologias

- Electron 33
- Node.js
- JavaScript, HTML e CSS sem framework de frontend
- `electron-builder` para empacotamento Windows
- `purecloud-platform-client-v2` para Genesys Cloud
- `playwright`, `cheerio` e `xlsx` nos extratores e tratamento de bases
- `.env` e configuracao local em `app.getPath('userData')`

## Estrutura

```text
MESA AUTO/
  main.js                    Processo principal Electron: API, CSV, limpeza, extracoes e build runtime
  preload.js                 Bridge IPC segura para a interface
  index.html                 Interface desktop
  package.json               Scripts npm e dependencias
  package-lock.json          Lockfile npm
  electron-builder.yml       Configuracao do instalador/portable Windows
  .env.example               Modelo seguro de variaveis locais
  .gitignore                 Arquivos sensiveis/gerados ignorados
  assets/
    icon.ico                 Icone da janela/build
    icon.svg                 Fonte editavel do icone
    logo.png                 Logo local
  scripts/extracao/          Extratores Site Novo, Site Antigo, GO e RS
  inputMesa/                 Pasta operacional local para CSV e executor externo
  docs/                      Documentacao tecnica e operacional
  legacy/                    Referencias antigas, fora do fluxo principal
  extracao/                  Material legado, fora do fluxo principal
```

## Instalacao

Pre-requisitos:

- Windows;
- Node.js e npm;
- acesso de rede ao Genesys e aos sistemas de origem;
- credenciais Genesys OAuth Client Credentials;
- credenciais dos sites de extracao, quando necessario.

Instale as dependencias:

```powershell
npm install
```

## Configuracao

Copie `.env.example` para `.env` e preencha apenas localmente. O `.env` real nao deve ser commitado.

Variaveis minimas:

```env
ORG_REGION=sa_east_1
CLIENT_ID=seu_client_id_oauth
CLIENT_SECRET=seu_client_secret_oauth
QUEUE_IDS=queue-id-1,queue-id-2
CLEANUP_CONCURRENCY=10
CLEANUP_RATE_LIMIT_PER_MINUTE=280
CLEANUP_RATE_LIMIT_FALLBACK_SECONDS=30
```

A tela **Configuracoes** tambem permite ajustar:

- credenciais Genesys;
- credenciais dos extratores;
- IDs de fila para consulta e limpeza;
- pastas locais de `inputMesa` e logs;
- rate limit, paralelismo e retry;
- parametros da subida externa da mesa.

O renderer nao recebe `CLIENT_SECRET` nem senhas ja salvas; ele recebe apenas indicadores como "secret configurado". Senhas vazias na tela preservam o valor salvo.

## Desenvolvimento

Validar sintaxe:

```powershell
npm run check
```

Abrir a aplicacao:

```powershell
npm start
```

Smoke test:

```powershell
npm run smoke
```

## Build Windows

Gerar pasta empacotada:

```powershell
npm run build
```

Gerar instalador e portable:

```powershell
npm run dist:win
```

Saidas principais:

```text
dist/win-unpacked/ADM Mesa de Distribuição.exe
dist/ADM-Mesa-de-Distribuicao-2.0.0-Setup-x64.exe
dist/ADM-Mesa-de-Distribuicao-2.0.0-Portable-x64.exe
```

Detalhes completos em [docs/BUILD_E_EXECUTAVEL.md](docs/BUILD_E_EXECUTAVEL.md).

## Como usar

1. Abra a aplicacao.
2. Acesse **Configuracoes** e valide credenciais, filas, caminhos e limites.
3. Em **Extrair Bases**, rode os extratores necessarios ou os quatro em concorrencia.
4. Em **Gerar Base**, aplique os filtros e gere o CSV.
5. Confira os cards de resumo e de distribuicao por estado.
6. Use **CSV + Subir Mesa** ou **Tudo Automatico** apenas quando os filtros e totais estiverem corretos.
7. Em **Limpeza da Mesa**, consulte, filtre, selecione e confirme antes de limpar.

## Limpeza da mesa

A limpeza nunca roda automaticamente ao abrir a tela. O backend exige confirmacao com `LIMPAR`.

Modos:

- **Selecionados**: limpa somente os `conversationId` selecionados na tabela.
- **Por fila/estado**: quando nao ha filtros ou ha somente filtro de estado, consulta os IDs de fila configurados para o estado e limpa o conjunto confirmado.

O processo registra total encontrado, processadas, sucesso, erro, pendentes, status atual e pausas por rate limit.

## Rate limit, paralelismo e retry

- `CLEANUP_CONCURRENCY`: conversas em processamento ao mesmo tempo.
- `CLEANUP_RATE_LIMIT_PER_MINUTE`: chamadas de limpeza iniciadas por minuto.
- `CLEANUP_RATE_LIMIT_FALLBACK_SECONDS`: espera padrao quando `Retry-After` nao vier.

Mesmo com paralelismo alto, o rate limiter global controla o ritmo total. Em `429`, a aplicacao pausa, mostra contagem regressiva, respeita `Retry-After` e continua a fila sem repetir conversas ja processadas.

## Seguranca

- `contextIsolation: true`.
- `nodeIntegration: false`.
- IPC exposto somente via `preload.js`.
- Bloqueio de novas janelas e navegacao externa.
- Secrets nao sao enviados ao renderer.
- `.env`, logs, CSVs, executaveis operacionais e scripts sensiveis ficam no `.gitignore`.
- Logs passam por sanitizacao para evitar tokens e secrets.

Leia tambem [docs/SEGURANCA.md](docs/SEGURANCA.md).

## Problemas conhecidos

- O build usa `asar: false` por compatibilidade com os scripts externos e Playwright. A evolucao recomendada e migrar para `asar: true` com `asarUnpack`.
- Neste Windows, a edicao de recursos do executavel pelo `winCodeSign` falha sem privilegio de criar links simbolicos. Por isso `signAndEditExecutable: false` fica ativo. O app gera `.exe` funcional; para embutir icone/metadata no arquivo do executavel, use Windows Developer Mode ou terminal admin e remova esse fallback.
- O script externo de subida (`MesaDistribuicao.py` ou `.exe`) e artefato operacional local; credenciais internas devem ser removidas antes de versionar.
- Nao existe checkpoint persistente da limpeza se o app for fechado no meio da operacao.

## Proximos passos

- Modularizar `main.js` em `src/services`, `src/config` e `src/utils`.
- Ativar `asar` com unpack controlado.
- Adicionar lint formal e testes automatizados para CSV, filtros e rate limiter.
- Adotar armazenamento seguro para secrets, como Windows Credential Manager.
- Assinar digitalmente o instalador em release oficial.

## Documentacao

- [Manual do Usuario](docs/MANUAL_USUARIO.md)
- [Documentacao Tecnica](docs/DOCUMENTACAO_TECNICA.md)
- [Arquitetura Desktop](docs/ARQUITETURA_DESKTOP.md)
- [Fluxo de Limpeza](docs/FLUXO_LIMPEZA.md)
- [API Genesys](docs/API_GENESYS.md)
- [Configuracoes](docs/CONFIGURACOES.md)
- [Seguranca](docs/SEGURANCA.md)
- [Build e Executavel](docs/BUILD_E_EXECUTAVEL.md)
- [Changelog](docs/CHANGELOG.md)
