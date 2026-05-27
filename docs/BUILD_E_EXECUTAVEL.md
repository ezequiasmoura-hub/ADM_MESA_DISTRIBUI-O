# Build e Executavel Windows

Este projeto esta configurado para gerar uma aplicacao desktop Windows com Electron e `electron-builder`.

## Diagnostico do build

- A aplicacao ja usa Electron (`main.js`, `preload.js`, `index.html`).
- O empacotador escolhido foi `electron-builder`, por ser direto para instalador NSIS, portable `.exe`, icone, recursos extras e automacao via `package.json`.
- A saida atual gera:
  - app unpacked em `dist/win-unpacked/`;
  - instalador em `dist/ADM-Mesa-de-Distribuicao-2.2.0-Setup-x64.exe`;
  - portable em `dist/ADM-Mesa-de-Distribuicao-2.2.0-Portable-x64.exe`.

## Pre-requisitos

- Windows 10/11;
- Node.js e npm;
- acesso de internet para baixar dependencias e binarios do Electron na primeira execucao;
- Git, se for versionar releases;
- permissao de rede aos sistemas de extracao e Genesys para testes funcionais.

## Instalar dependencias

```powershell
npm install
```

## Scripts disponiveis

```powershell
npm start              # abre o app em desenvolvimento
npm run dev            # abre em modo dev
npm run smoke          # abre e fecha automaticamente para validar inicializacao
npm run check          # valida sintaxe JS dos arquivos principais
npm run lint           # alias de check
npm test               # alias de check
npm run build          # gera dist/win-unpacked
npm run dist           # alias de dist:win
npm run dist:win       # gera instalador NSIS e portable
npm run dist:win:portable
```

## Rodar em desenvolvimento

```powershell
npm start
```

Ou:

```powershell
.\start.bat
```

## Validar antes do build

```powershell
npm run check
npm run smoke
```

Validacoes manuais recomendadas:

- abrir a tela **Configuracoes**;
- testar conexao Genesys;
- consultar a mesa sem limpar;
- gerar CSV em modo seguro;
- rodar ao menos um extrator em ambiente controlado;
- confirmar que `.env` nao aparece no Git.

## Gerar app unpacked

```powershell
npm run build
```

Saida:

```text
dist/win-unpacked/ADM Mesa de Distribuição.exe
```

Esse formato e bom para teste local porque preserva a pasta completa do app.

## Gerar instalador e portable

```powershell
npm run dist:win
```

Saidas:

```text
dist/ADM-Mesa-de-Distribuicao-2.2.0-Setup-x64.exe
dist/ADM-Mesa-de-Distribuicao-2.2.0-Portable-x64.exe
```

O instalador cria atalhos e pode permitir escolha de pasta. O portable e melhor para teste rapido ou operacao sem instalacao formal.

## Configuracao do electron-builder

A configuracao fica em `electron-builder.yml`:

- `appId`: `br.com.backoffice.adm-mesa-distribuicao`;
- `productName`: `ADM Mesa de Distribuição`;
- saida em `dist/`;
- recursos em `assets/`;
- targets Windows `nsis` e `portable`;
- icone base em `assets/icon.ico`;
- exclusao de `.env`, logs, CSVs, planilhas, executaveis operacionais e arquivos sensiveis de `inputMesa`.

## Sobre `asar`

Atualmente:

```yaml
asar: false
```

Motivo: os extratores JavaScript, Playwright e execucoes externas precisam de caminhos simples no pacote. Para uma release mais madura, o recomendado e migrar para:

```yaml
asar: true
asarUnpack:
  - scripts/extracao/**/*
  - node_modules/playwright/**/*
```

Essa migracao deve ser testada com todos os extratores antes de publicar.

## Icone

Arquivos atuais:

```text
assets/icon.ico
assets/icon.svg
assets/logo.png
```

O `main.js` usa `assets/icon.ico` como icone da janela. O `electron-builder.yml` tambem aponta para esse arquivo.

Neste ambiente Windows, a etapa de edicao de recursos do executavel falhou ao extrair `winCodeSign` porque o usuario nao tem privilegio de criar links simbolicos. Para manter o build funcional, foi configurado:

```yaml
win:
  signAndEditExecutable: false
```

Com isso o `.exe` e gerado e testado, mas a edicao de metadata/icone no arquivo do executavel pode ficar limitada. Para release final com icone embutido no arquivo:

1. habilite **Developer Mode** no Windows ou rode o terminal como administrador;
2. remova `signAndEditExecutable: false`;
3. rode `npm run dist:win`;
4. confira o icone no arquivo gerado.

## Teste do executavel

Depois do build:

```powershell
& ".\dist\win-unpacked\ADM Mesa de Distribuição.exe" --smoke-test
```

Tambem teste manualmente:

- abrir o instalador;
- abrir o portable;
- configurar pastas locais;
- gerar CSV;
- consultar Genesys;
- nao executar limpeza real sem conferencia operacional.

## Arquivos incluidos e excluidos

Incluidos:

- `main.js`;
- `preload.js`;
- `index.html`;
- `package.json`;
- `scripts/**/*`;
- `assets/**/*`;
- `docs/**/*`;
- `README.md`;
- `scripts/mesa-upload.js` para subida integrada da mesa.

Excluidos:

- `.env`;
- logs;
- CSVs e planilhas de `inputMesa`;
- `inputMesa/MesaDistribuicao.py`;
- `inputMesa/MesaDistribuicao.exe`;
- `extracao/`;
- `legacy/`.

## Caminhos no app empacotado

No desenvolvimento, `inputMesa` padrao fica na pasta do projeto.

No app empacotado, se `INPUT_MESA_DIR` nao for informado, o app usa:

```text
%APPDATA%/ADM Mesa de Distribuição/inputMesa
```

Logs, por padrao:

```text
%APPDATA%/ADM Mesa de Distribuição/logs
```

Esses caminhos podem ser alterados na tela **Configuracoes**.

## Problemas comuns

### `electron-builder` nao encontrado

```powershell
npm install
```

### Erro de symlink no `winCodeSign`

Mensagem parecida:

```text
Cannot create symbolic link ... libcrypto.dylib
```

Solucoes:

- manter `signAndEditExecutable: false` para gerar `.exe` funcional;
- ou habilitar Windows Developer Mode/admin e remover o fallback.

### Playwright nao encontra navegador

Rode:

```powershell
npx playwright install chromium
```

Depois gere o build novamente.

### Arquivo operacional nao encontrado

Confirme na tela **Configuracoes** a pasta `INPUT_MESA_DIR`. O app usa essa pasta para `mesa_distribuicao.csv`; a subida fica empacotada em `scripts/mesa-upload.js`.

### Credenciais nao carregam

Verifique:

- `.env` local;
- campos salvos pela UI;
- se voce deixou senha vazia para preservar senha anterior;
- se `.env` nao foi movido para dentro do pacote.

## Publicacao de nova versao

1. Atualize `version` em `package.json`.
2. Atualize `docs/CHANGELOG.md`.
3. Rode `npm run check`.
4. Rode `npm run smoke`.
5. Rode `npm run dist:win`.
6. Teste `Setup` e `Portable`.
7. Gere commit e tag de release.

## Resultado validado nesta preparacao

- `npm run check`: OK.
- `npm run smoke`: OK.
- `npm run build`: OK com `signAndEditExecutable: false`.
- `npm run dist:win`: OK, gerando instalador e portable.
- Smoke test do executavel empacotado: OK.
