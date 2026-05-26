# Arquitetura

Este arquivo foi mantido como entrada curta para compatibilidade com a documentacao anterior.

A documentacao tecnica completa e atual esta em:

- [DOCUMENTACAO_TECNICA.md](DOCUMENTACAO_TECNICA.md)
- [ARQUITETURA_DESKTOP.md](ARQUITETURA_DESKTOP.md)
- [FLUXO_LIMPEZA.md](FLUXO_LIMPEZA.md)
- [API_GENESYS.md](API_GENESYS.md)

Resumo rapido:

- `main.js`: processo principal Electron, Genesys, geracao CSV, limpeza, extracoes e execucao de subida.
- `preload.js`: bridge IPC segura.
- `index.html`: UI completa.
- `scripts/extracao/`: extratores oficiais em JavaScript.
- `inputMesa/`: artefatos operacionais locais, nao versionados quando contem dados/sigilos.
- `docs/`: documentacao do projeto.

Para manutencao, use `DOCUMENTACAO_TECNICA.md` como fonte principal.
