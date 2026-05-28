# Changelog

## 2.3.0 - 2026-05-28

### Correcoes

- Corrigida a montagem de filas para respeitar os IDs configurados sem somar automaticamente as filas padrao de Varejo.
- A limpeza por ID da mesa agora herda os `QUEUE_IDS` configurados quando `CLEANUP_QUEUE_IDS` ainda estiver com os IDs legados padrao.
- Conversas de filas configuradas fora do mapa padrao passam a ser reconhecidas pelo `queueId` configurado.
- Extratores externos passam a receber `NODE_PATH` apontando para as dependencias empacotadas do app.
- Adicionado fallback do Playwright para tentar Microsoft Edge/Google Chrome quando o Chromium padrao nao estiver disponivel na maquina instalada.

### Melhorias

- `CLEANUP_QUEUE_IDS` aceita linhas no formato `ESTADO|id-da-fila` para mapear filas fora do padrao ao filtro de estado.
- Adicionado preload `scripts/extracao/playwright-fallback.js` para aplicar fallback de navegador tambem em scripts externos.

## 2.2.0 - 2026-05-27

### Alteracoes

- Adicionada acao **Limpar tratados fora** na aba **Limpeza da Mesa**.
- A acao consulta a mesa, cruza com as bases de origem configuradas e seleciona apenas protocolos que nao existem mais na base.
- Protocolos sem identificacao sao ignorados por seguranca.
- A limpeza continua exigindo confirmacao antes de desconectar conversas.

## 2.1.0 - 2026-05-27

### Alteracoes

- Subida da mesa migrada de `MesaDistribuicao.py/.exe` para `scripts/mesa-upload.js`.
- Credenciais de subida removidas do script e centralizadas em `.env`/tela de configuracoes.
- Adicionada configuracao `MESA_UPLOAD_CREDENTIALS` para multiplas credenciais no formato `nome|client_id|client_secret`.
- Caminhos externos dos extratores passaram a ser respeitados mesmo fora da pasta embutida.
- Build passou a empacotar o runner JavaScript de subida junto com a aplicacao.
- Versao do aplicativo atualizada para `2.1.0`.

### Correcoes

- Corrigida a normalizacao que descartava scripts externos de extracao apos instalar o app.
- Removida dependencia operacional do `MesaDistribuicao.exe` para subida da mesa.
- Ignorados logs JSONL gerados por testes/operacao.

## 2.0.1 - 2026-05-26

### Alteracoes

- Configurado empacotamento Windows com `electron-builder`.
- Adicionados targets NSIS e portable.
- Adicionados scripts `build`, `dist`, `dist:win`, `dist:win:portable`, `smoke`, `lint` e `test`.
- Adicionados `assets/icon.ico`, `assets/logo.png` e `assets/icon.svg`.
- Adicionados caminhos configuraveis `INPUT_MESA_DIR` e `LOG_DIR`.
- Logs passaram a usar pasta adequada para app desktop quando empacotado.
- Configuracao publica enviada ao renderer agora omite `CLIENT_SECRET` e senhas salvas.
- Extratores passam a usar o runtime do proprio Electron empacotado quando `NODE_BIN` nao estiver configurado.
- Criadas documentacoes `ARQUITETURA_DESKTOP.md` e `SEGURANCA.md`.

### Correcoes

- Evitado envio de secrets para a interface.
- Bloqueadas novas janelas e navegacao externa no Electron.
- Separados os nomes dos artefatos de instalador e portable.

### Observacoes

- `signAndEditExecutable: false` foi mantido porque este Windows nao possui privilegio para criar symlinks durante a extracao do `winCodeSign`.
- `asar: false` permanece por compatibilidade com extratores e Playwright ate validacao de `asarUnpack`.

## 2.0.0 - 2026-05-25

### Alteracoes

- Aplicacao Electron consolidada para gestao da mesa de protocolos.
- Tela **Gerar Base** com filtros operacionais e geracao de `inputMesa/mesa_distribuicao.csv`.
- Consulta ao Genesys antes da geracao para remover protocolos ja existentes na mesa.
- Tela **Limpeza da Mesa** integrada ao app principal.
- Consulta da mesa via API Genesys com tabela, filtros e selecao.
- Limpeza por itens selecionados.
- Limpeza por ID de fila quando nao ha filtros ou quando ha somente filtro de estado.
- Confirmacao obrigatoria antes da limpeza real.
- Logs JSONL de limpeza em `logs/`.
- Extratores JavaScript integrados em `scripts/extracao/`.
- Tela **Extrair Bases** com botoes individuais e botao para rodar os quatro scripts.
- Tela **Modo Automatico** para rodar extracoes, gerar base com filtros atuais e opcionalmente subir a mesa.
- Configuracoes de credenciais dos extratores pela interface.
- Modo claro/escuro.

### Melhorias

- Rate limiter global da limpeza com padrao `280 req/min`.
- Limite configuravel ate `300 req/min`.
- Paralelismo da limpeza configuravel, padrao `10`.
- Retry automatico em `429`, respeitando `Retry-After`.
- Fallback de espera configuravel quando nao ha `Retry-After`, padrao `30s`.
- Indicadores de progresso da limpeza: encontradas, processadas, sucesso, erro, pendentes, req/min e status.
- Contagem regressiva durante pausa por rate limit.
- Botoes **todos** e **limpar** nos filtros de tags da geracao.
- Sanitizacao de logs de extracao para mascarar credenciais conhecidas.
- Ambiente UTF-8 ao executar `MesaDistribuicao.py` ou `.exe`.

### Correcoes

- Geracao da base passou a usar consulta rapida de protocolos da mesa, evitando leitura detalhada desnecessaria.
- Filtros de limpeza passaram a usar estado/empresa com base no `queueId`.
- Filtros de limpeza passaram a aceitar multiselecao.
- Modo automatico passou a rodar as quatro extracoes antes de gerar/subir a mesa.
- Modo automatico usa os filtros atuais da aba **Gerar Base**.
- Nome do CSV final padronizado como `mesa_distribuicao.csv`.

### Observacoes

- O build `.exe` da aplicacao Electron ainda nao esta configurado no `package.json`.
- O script externo `inputMesa/MesaDistribuicao.py` encontrado no ambiente contem credenciais embutidas e deve ser tratado como artefato local sensivel.
- `legacy/` e `extracao/` foram mantidos como referencia, mas nao fazem parte do fluxo principal atual.
