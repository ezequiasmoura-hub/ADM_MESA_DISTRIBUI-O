# Arquitetura Desktop

Este documento registra o diagnostico arquitetural e o caminho adotado para transformar a aplicacao em um executavel Windows profissional.

## Diagnostico da stack atual

- **Frontend**: HTML, CSS e JavaScript em `index.html`.
- **Desktop shell**: Electron.
- **Processo principal**: `main.js`.
- **Bridge segura**: `preload.js` com `contextBridge`.
- **Backend local**: nao existe servidor Express; o `main.js` atua como backend local via IPC.
- **Integracao externa**: Genesys Cloud via SDK `purecloud-platform-client-v2`.
- **Autenticacao**: OAuth Client Credentials.
- **Automacao/extracao**: scripts Node em `scripts/extracao/`.
- **Empacotamento**: `electron-builder`.
- **Configuracao**: `.env` local e `mesa_config.json` na pasta de dados do usuario.

## O que esta correto

- O projeto ja tem uma base natural para `.exe`, pois usa Electron.
- A UI nao acessa Node diretamente.
- `contextIsolation` esta ativado e `nodeIntegration` esta desativado.
- O `preload.js` limita os canais expostos para a interface.
- Credenciais salvas nao sao devolvidas em texto claro para o renderer.
- A limpeza fica no processo principal, fora do frontend.
- O build Windows ja gera app unpacked, instalador e portable.
- `.env`, logs, bases e artefatos sensiveis estao ignorados pelo Git.

## O que ainda esta incompleto

- `main.js` ainda concentra muitas responsabilidades.
- Nao existe suite automatizada de testes de regra de negocio.
- O build esta com `asar: false` por compatibilidade operacional.
- O armazenamento de secrets ainda e arquivo local/configuracao local, nao Windows Credential Manager.
- A assinatura digital do instalador ainda nao foi configurada.
- A edicao de recursos do executavel esta desativada neste ambiente por restricao de symlink do Windows.

## Arquitetura recomendada

A tecnologia recomendada e **Electron + electron-builder**.

Motivos:

- a aplicacao ja esta em Electron;
- precisa acessar arquivos locais, rodar scripts e abrir dialogos nativos;
- precisa empacotar dependencias Node e scripts JavaScript;
- `electron-builder` gera instalador NSIS e portable com pouca friccao;
- Tauri exigiria reescrita parcial para Rust;
- `pkg` empacotaria Node, mas nao resolveria a interface desktop HTML com seguranca e janelas;
- PyInstaller nao faz sentido como empacotador principal porque o app atual e JavaScript/Electron.

## Estrutura atual

```text
main.js
  configuracao
  seguranca Electron
  IPC
  Genesys
  geracao CSV
  limpeza
  extracoes
  execucao de MesaDistribuicao.py/.exe

preload.js
  API controlada para o renderer

index.html
  layout
  filtros
  tabelas
  estado da UI
  chamadas window.api

scripts/extracao/
  scripts de extracao em JavaScript

assets/
  icone e logo

docs/
  documentacao
```

## Estrutura alvo para evolucao

Quando houver janela para refatorar com baixo risco, mover gradualmente para:

```text
src/
  main/
    app.js
    ipc.js
    windows.js
  renderer/
    index.html
    styles.css
    app.js
    components/
  services/
    genesysService.js
    mesaCsvService.js
    cleanupService.js
    extractionService.js
    uploadService.js
  config/
    env.js
    runtimeConfig.js
    defaults.js
  utils/
    rateLimiter.js
    csv.js
    logging.js
    sanitize.js
```

A refatoracao deve preservar primeiro o comportamento e so depois separar responsabilidades.

## Processo principal

Responsabilidades atuais de `main.js`:

- criar a janela Electron;
- aplicar boas praticas de seguranca;
- carregar `.env` e configuracoes salvas;
- autenticar no Genesys;
- consultar mesa;
- gerar CSV;
- limpar conversas;
- rodar extratores;
- executar o processo externo de subida;
- emitir progresso para o renderer;
- registrar logs.

## Renderer

`index.html` contem a interface e o estado visual. Ele chama apenas funcoes expostas por `window.api`, criadas no `preload.js`.

O renderer nao deve:

- ler arquivos diretamente;
- receber `CLIENT_SECRET`;
- chamar APIs Genesys diretamente;
- executar limpeza sem passar pelo IPC validado.

## Preload

`preload.js` usa `contextBridge.exposeInMainWorld('api', ...)` e expoe apenas os canais necessarios:

- configuracao;
- dialogos;
- gerar base;
- listar mesa;
- limpar mesa;
- executar extracoes;
- testar Genesys;
- modo automatico;
- progresso.

## Fluxo de configuracao

1. `main.js` carrega defaults.
2. Carrega `.env` da raiz.
3. Carrega `inputMesa/.env`.
4. Carrega `mesa_config.json` em `app.getPath('userData')`.
5. Normaliza limites e caminhos.
6. Envia ao renderer apenas uma configuracao publica, sem secrets.

## Fluxo de build

```text
npm run check
  -> valida sintaxe

npm run build
  -> dist/win-unpacked

npm run dist:win
  -> Setup.exe
  -> Portable.exe
```

## Decisoes de empacotamento

- `electron-builder` escolhido para Windows.
- Targets: `nsis` e `portable`.
- `asar: false` temporariamente, para nao quebrar extratores e Playwright.
- `signAndEditExecutable: false` temporariamente, por limitacao de symlink no Windows atual.
- Artefatos gerados em `dist/`, ignorado pelo Git.

## Riscos tecnicos

- Arquivo `main.js` grande aumenta custo de manutencao.
- Qualquer mudanca em limpeza e Genesys precisa teste em modo consulta antes de producao.
- Secrets em arquivo local dependem da protecao do usuario Windows.
- Playwright em app empacotado exige teste em maquina limpa.
- Sem assinatura digital, o Windows SmartScreen pode alertar usuarios.

## Plano recomendado

1. Manter Electron e `electron-builder`.
2. Usar a versao atual para pacote operacional controlado.
3. Criar testes automatizados para CSV, filtros, rate limiter e sanitizacao.
4. Modularizar `main.js` em pequenos servicos.
5. Migrar `asar` para `true` com `asarUnpack`.
6. Migrar secrets para armazenamento seguro.
7. Configurar certificado de assinatura digital para release.
