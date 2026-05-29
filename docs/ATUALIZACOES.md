# Atualizacoes automaticas

Este projeto usa `electron-updater` com GitHub Releases.

## Como funciona

1. O app instalado abre.
2. O processo principal chama `autoUpdater.checkForUpdates()`.
3. O `electron-updater` consulta a release mais recente no GitHub.
4. Se houver versao maior que a instalada, a interface mostra a mensagem de atualizacao.
5. O usuario confirma o download.
6. Quando o download termina, o app pede confirmacao para reiniciar e instalar.

O botao **Verificar atualizacao** na barra inferior executa a mesma verificacao manualmente.

## Importante para a primeira atualizacao

Versoes anteriores a `2.4.0` nao possuem auto-update. Quem ja recebeu uma versao antiga precisa instalar manualmente a `2.4.0` uma vez.

Depois disso, as proximas versoes passam a aparecer dentro do app.

## Fonte das atualizacoes

Repositorio configurado:

```text
https://github.com/ezequiasmoura-hub/ADM_MESA_DISTRIBUI-O
```

Configuracao em `electron-builder.yml`:

```yaml
publish:
  - provider: github
    owner: ezequiasmoura-hub
    repo: ADM_MESA_DISTRIBUI-O
    releaseType: release
```

## Como publicar uma nova versao

1. Altere a versao em `package.json`.
2. Atualize `docs/CHANGELOG.md`.
3. Rode:

```powershell
npm run check
npm run dist:win
```

4. Crie uma release no GitHub com a mesma tag da versao, por exemplo:

```text
v2.4.1
```

5. Anexe os arquivos gerados em `dist/`.

Arquivos importantes:

- `ADM-Mesa-de-Distribuicao-VERSAO-Setup-x64.exe`;
- `ADM-Mesa-de-Distribuicao-VERSAO-Setup-x64.exe.blockmap`;
- `latest.yml`.

O portable pode ser anexado tambem para distribuicao manual, mas o fluxo de auto-update deve priorizar o instalador NSIS.

## Publicacao automatica por tag

O repositorio possui workflow em `.github/workflows/release.yml`.

Quando uma tag `v*` e enviada para o GitHub, por exemplo:

```powershell
git tag v2.4.1
git push origin main
git push origin v2.4.1
```

O GitHub Actions:

1. instala dependencias com `npm ci`;
2. roda `npm run dist:win`;
3. publica uma GitHub Release;
4. anexa instalador, portable, `.blockmap` e `latest.yml`.

Esse e o caminho recomendado para atualizar usuarios sem depender de `GH_TOKEN` local na maquina de build.

## Publicacao automatica por terminal

Se o terminal tiver `GH_TOKEN` configurado com permissao para criar releases:

```powershell
$env:GH_TOKEN="token_com_permissao_repo"
npm run release:github
```

Nao coloque `GH_TOKEN` no `.env`, no codigo, em documentacao com valor real, nem em commit.

## Repositorio publico ou privado

Para usuarios finais receberem atualizacao sem token embutido no app, o caminho mais simples e manter as releases acessiveis pelo GitHub.

Se o repositorio for privado, nao embuta token no frontend nem no pacote. Nesse caso, prefira:

- publicar releases em um repositorio/canal publico sem codigo sensivel;
- usar servidor interno de updates;
- distribuir manualmente o instalador;
- ou implementar um endpoint interno autenticado de forma segura.

## Teste

Para testar:

1. Instale a versao atual.
2. Publique uma release com versao maior.
3. Abra o app instalado.
4. Aguarde a verificacao automatica ou clique em **Verificar atualizacao**.
5. Confirme download e instalacao.

Em desenvolvimento (`npm start`), a interface informa que auto-update funciona apenas no app instalado.
