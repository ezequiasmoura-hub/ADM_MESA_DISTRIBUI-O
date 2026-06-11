# Extrator Agendado de Bases

Aplicativo Electron independente do ADM Mesa de Distribuicao.

Site Antigo, GO e RS validam o CSV ao final de cada execucao. Arquivos vazios, antigos, com cabecalho invalido ou tentativas encerradas com erro sao repetidos automaticamente a cada 15 segundos ate uma base valida ser gravada. O intervalo pode ser alterado por `EXTRACTION_RETRY_DELAY_SECONDS`; `EXTRACTION_MAX_ATTEMPTS=0` mantem tentativas ilimitadas.

## Recursos

- Site Novo, Site Antigo/BKO All, GO e RS/CEEE;
- usuario, senha e pasta de saida por extrator;
- senha criptografada localmente com `safeStorage` do Electron;
- execucao individual ou dos quatro em paralelo;
- agenda diaria com varios horarios exatos;
- execucao em segundo plano pela bandeja do Windows;
- opcao de iniciar com o Windows;
- logs locais em `%APPDATA%/Extrator Agendado de Bases/logs`.

## Desenvolvimento

```powershell
npm run extractor-app:start
```

## Build Windows

```powershell
npm run extractor-app:dist
```

Os artefatos sao gerados em `dist-extrator/`.

O agendamento funciona enquanto o aplicativo estiver aberto ou minimizado na bandeja. A maquina precisa estar ligada e com acesso aos sites e pastas configurados.

## Pasta de saida

Cada extrator grava diretamente na pasta escolhida no respectivo card. O Site Novo gera `01_Todos_Aberto.xls` e `02_Todos_Pendente.xls` nessa pasta, sem acrescentar automaticamente outra subpasta `SITE NOVO`.
