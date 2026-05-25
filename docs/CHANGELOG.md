# Changelog

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
