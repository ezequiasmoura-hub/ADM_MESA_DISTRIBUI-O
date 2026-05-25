# Build e Executavel

Este documento explica o estado atual do build e como preparar a geracao de `.exe`.

## Estado atual

O projeto roda em desenvolvimento com Electron:

```powershell
npm start
```

O `package.json` atual nao possui script de empacotamento (`build`, `dist` ou `make`) e nao possui `electron-builder` instalado. Portanto, a geracao do `.exe` da aplicacao Electron ainda e uma etapa pendente de configuracao.

Importante:

- `inputMesa/MesaDistribuicao.exe` e o executor externo da subida da mesa.
- Ele nao e o executavel da aplicacao Electron.

## Pre-requisitos

- Windows;
- Node.js;
- npm;
- dependencias instaladas com `npm install`;
- credenciais e caminhos configurados;
- Git, se o objetivo for versionar ou gerar release a partir de repositorio.

## Instalar dependencias

```powershell
npm install
```

## Rodar em desenvolvimento

```powershell
npm start
```

ou:

```powershell
.\start.bat
```

## Validar antes do build

```powershell
npm run check
```

Tambem recomenda-se testar:

- abrir a aplicacao;
- salvar configuracoes;
- testar conexao Genesys;
- gerar CSV em **So CSV**;
- consultar a aba de limpeza sem executar limpeza real;
- testar extracoes em ambiente controlado.

## Configuracao recomendada para gerar `.exe`

Como ainda nao ha empacotador no projeto, uma opcao comum e adicionar `electron-builder`.

Instalacao sugerida:

```powershell
npm install --save-dev electron-builder
```

Adicionar ao `package.json`:

```json
{
  "scripts": {
    "build": "electron-builder --win --x64"
  },
  "build": {
    "appId": "br.com.equatorial.mesa-distribuicao-bko",
    "productName": "Mesa de Distribuicao BKO",
    "directories": {
      "output": "dist"
    },
    "files": [
      "main.js",
      "preload.js",
      "index.html",
      "package.json",
      "scripts/**/*",
      "inputMesa/RODARMESA.bat"
    ],
    "win": {
      "target": "nsis"
    }
  }
}
```

Esse bloco e uma sugestao tecnica. Antes de empacotar, decidir se `inputMesa/MesaDistribuicao.exe` e `inputMesa/MesaDistribuicao.py` entram no pacote. Como esses arquivos podem conter credenciais ou logica operacional sensivel, o recomendado e nao empacotar ate externalizar as credenciais.

## Comando de build apos configurar

Depois de instalar e configurar o empacotador:

```powershell
npm run build
```

ou diretamente:

```powershell
npx electron-builder --win --x64
```

## Onde o executavel seria gerado

Com `electron-builder`, a saida padrao configurada acima seria:

```text
dist/
```

Normalmente o instalador `.exe` fica dentro de `dist/`.

## Como testar o executavel

1. Instalar/abrir o `.exe` gerado.
2. Configurar credenciais pela tela.
3. Confirmar se `mesa_config.json` e salvo na pasta de dados do usuario.
4. Testar conexao Genesys.
5. Gerar CSV em modo **So CSV**.
6. Verificar se `inputMesa/mesa_distribuicao.csv` e criado no local esperado do app empacotado.
7. Testar leitura dos scripts de extracao empacotados.
8. Testar limpeza apenas com consulta, sem executar limpeza real.

## Problemas comuns

### `electron-builder` nao encontrado

Instale:

```powershell
npm install --save-dev electron-builder
```

### Arquivos nao encontrados no app empacotado

Revisar a lista `files` da configuracao de build e os caminhos relativos usados em `main.js`.

### Scripts de extracao nao rodam

Verificar:

- se `scripts/extracao/` foi incluido no pacote;
- se `NODE_BIN` aponta para runtime valido;
- se as credenciais estao no `.env` ou salvas pela UI;
- se o navegador do Playwright foi empacotado/instalado corretamente.

### `MesaDistribuicao.py` ou `.exe` nao encontrado

O app procura em:

```text
inputMesa/MesaDistribuicao.py
inputMesa/MesaDistribuicao.exe
```

No pacote final, decidir se esses arquivos serao distribuidos junto da aplicacao ou mantidos em uma pasta externa operacional.

### Erro de encoding no Python

O app ja injeta:

```env
PYTHONIOENCODING=utf-8
PYTHONUTF8=1
```

Se persistir, validar a instalacao do Python e a codificacao do console.

## Icone/capa do executavel

O `main.js` tenta usar:

```text
icon.png
```

na raiz do projeto. Se for usar `electron-builder`, configure tambem:

```json
"win": {
  "icon": "icon.ico",
  "target": "nsis"
}
```

Atualmente nao foi identificado `icon.png` ou `icon.ico` na raiz durante a revisao. Isso deve ser criado antes de um build final com identidade visual.

## Cuidados antes de distribuir

- Nao incluir `.env`.
- Nao incluir logs.
- Nao incluir CSVs gerados.
- Nao incluir scripts com client secret embutido.
- Testar em maquina limpa.
- Validar que a limpeza exige confirmacao.
- Validar `CLEANUP_RATE_LIMIT_PER_MINUTE`.
