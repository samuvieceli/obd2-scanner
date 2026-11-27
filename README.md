# OBD2 Scanner

Scanner OBD2 de código aberto para Windows, feito para adaptadores **ELM327** (originais, clones e simuladores).
Open-source OBD2 scanner for Windows and ELM327 adapters. *(English summary at the end.)*

## O que ele faz

- **Conexão** por USB, Bluetooth clássico (porta COM), Wi-Fi e **modo demonstração** (carro virtual, sem adaptador). Bluetooth LE vem na próxima versão.
- **Painel ao vivo** com mais de 80 parâmetros (rotação, temperatura, correção de combustível, sondas lambda e de banda larga, turbo, torque, filtro de partículas, hodômetro, tensão da bateria...), cada um com explicação curta.
- **Head-up display (HUD)**: até 4 valores enormes em fundo preto, em tela cheia, com opção espelhada para refletir no para-brisa.
- **Interpretação automática** dos dados (superaquecimento, mistura pobre/rica, carga da bateria, sonda lambda, catalisador).
- **Gráficos** em tempo real, sincronizados, com exportação para imagem PNG.
- **Códigos de falha**: confirmados, pendentes e permanentes, com descrição em português; apagar códigos; quadro congelado; consulta de qualquer código.
- **Veículo e prontidão**: chassi (VIN) decodificado, monitores de prontidão, luz de injeção.
- **Terminal AT** para comandos diretos ao adaptador.
- **Gravações e relatórios**: CSV (inclusive no formato do Excel brasileiro), JSON, e relatório para imprimir ou salvar como PDF.
- Interface em **português (Brasil)** e **inglês (EUA)**, tema escuro e claro, e **glossário** com todos os termos.

## Como instalar no Windows (sem programar)

1. Abra a aba **Actions** deste repositório no GitHub e clique na execução mais recente do **CI** com sinal verde.
2. No fim da página, em **Artifacts**, baixe `obd2-scanner-windows-instalador`.
3. Descompacte o arquivo `.zip` e execute o instalador `OBD2 Scanner_..._x64-setup.exe`.
4. O Windows pode avisar que o programa é de um editor desconhecido (o instalador ainda não é assinado digitalmente): clique em **Mais informações → Executar assim mesmo**.

Detalhes e solução de problemas: [docs/COMO-USAR.md](docs/COMO-USAR.md).

## Para desenvolvedores

Requisitos: [Rust](https://rustup.rs), [Node.js 22](https://nodejs.org) e, no Windows, as "Ferramentas de Build do Visual Studio" (C++). Veja os [pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # abre o app em modo de desenvolvimento
npm run tauri build    # gera o instalador em target/release/bundle
cargo test -p obd-core # testes do núcleo
```

Arquitetura: [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Créditos e licença

Licença **GPL-3.0-or-later**. Fórmulas conforme SAE J1979 / ISO 15031-5. Partes aproveitadas de projetos abertos
(detalhes em [docs/CREDITOS.md](docs/CREDITOS.md)):

- [pyOBD](https://github.com/alexfare/pyobd) (GPL-2.0-or-later): ~1.900 descrições de códigos genéricos (inglês), detecção rápida da velocidade serial e tentativa de protocolos um por um.
- [AndrOBD](https://github.com/fr3ts0n/AndrOBD) (GPL-3.0): ~2.500 descrições de códigos em português do Brasil; lista de PIDs (`pids.csv`) usada para conferir fórmulas dos parâmetros extras; ideia do modo head-up display.
- [ELMduino](https://github.com/PowerBroker2/ELMduino) (MIT): ideia da leitura rápida (vários parâmetros por pedido).
- [Libre Diagnostic](https://github.com/Libre-Diagnosctic/libre-automotive-diagnostic) (AGPL-3.0): tabelas de códigos específicos de 10 marcas.
- [obdium](https://github.com/provrb/obdium) (GPL-3.0) e [o3DIAG](https://github.com/openw3rk-DEVELOP/o3DIAG) (MIT): referência de ideias.

---

**English:** OBD2 Scanner is a Rust + Tauri 2 desktop app for ELM327 adapters over USB, Bluetooth classic (COM port),
Wi-Fi and a built-in demo simulator. It shows live data with explanations and automatic interpretation, charts, trouble
codes (read/clear, freeze frame), readiness monitors, VIN decoding, an AT terminal, and exports CSV/JSON/PNG plus a
printable report. UI in Brazilian Portuguese and US English. See `docs/ARCHITECTURE` (Portuguese) for the design.
