# OBD2 Scanner

Scanner OBD2 de código aberto para Windows, feito para adaptadores **ELM327** (originais, clones e simuladores).
Open-source OBD2 scanner for Windows and ELM327 adapters. *(English summary at the end.)*

## O que ele faz

- **Conexão** por USB, Bluetooth clássico (porta COM), **Bluetooth LE**, Wi-Fi e **modo demonstração** (carro virtual, sem adaptador). Tolerante aos defeitos comuns dos clones ELM327 (repete pedidos perdidos, avisa quais comandos o adaptador recusa), com **detecção de travamento** do adaptador (reinicia e reconfigura sozinho) e **reconexão automática** quando o Bluetooth ou o cabo cai.
- **Perfis para vários carros**, reconhecidos pelo chassi (VIN), cada um com combustível, cilindrada, alertas e resultados próprios.
- **Unidades** à escolha: km/h ou mph, °C ou °F, kPa, bar ou psi, km ou milhas, km/L, L/100 km ou mpg.
- **Painel ao vivo** com mais de 80 parâmetros (rotação, temperatura, correção de combustível, sondas lambda e de banda larga, turbo, torque, filtro de partículas, hodômetro, tensão da bateria...), cada um com explicação curta.
- **Cartões ou mostradores com ponteiro**, **alertas** com som quando um valor sai da faixa segura e **computador de bordo** (consumo em km/L, distância, combustível gasto).
- **Testes de desempenho** 0–100, 100–0, 40–80 e 80–120 km/h com detecção automática do início e do fim reais de cada teste, distância e histórico.
- **Head-up display (HUD)**: até 4 valores enormes em fundo preto, em tela cheia, com opção espelhada para refletir no para-brisa.
- **Interpretação automática** dos dados (superaquecimento, mistura pobre/rica, carga da bateria, sonda lambda, catalisador).
- **Gráficos** em tempo real, sincronizados, com exportação para imagem PNG.
- **Códigos de falha**: confirmados, pendentes e permanentes, com descrição em português e tabelas de 10 marcas; apagar códigos; quadro congelado; consulta de qualquer código.
- **Testes da central (Modo 06)**: resultados dos autotestes (sondas, catalisador, falhas de combustão...) com aprovado/reprovado, para achar problemas antes da luz de injeção acender.
- **Veículo e prontidão**: chassi (VIN) decodificado, monitores de prontidão, luz de injeção e **lista das centrais** que respondem (motor, câmbio...) com número da peça e versão do software.
- **Teste de compatibilidade do adaptador**: descobre a versão real do ELM327 (clones costumam anunciar mais do que fazem).
- **Terminal AT** para comandos diretos ao adaptador.
- **Gravações e relatórios**: CSV (inclusive no formato do Excel brasileiro), JSON, **reprodução de gravações** como se fosse ao vivo, e relatório para imprimir ou salvar como PDF.
- Interface em **português (Brasil)** e **inglês (EUA)**, 8 temas (automático, escuro, claro, noturno vermelho, alto contraste, oficina, terminal e papel) e **glossário** com todos os termos.

## Baixar e instalar (Windows 10 e 11)

**[⬇ Baixar a versão mais recente](https://github.com/samuvieceli/obd2-scanner/releases/latest)**: na página que abrir, clique em `OBD2-Scanner-...-Windows-instalador.exe` (em *Assets*) e execute o arquivo baixado. O Windows pode avisar que o programa é de um editor desconhecido (o instalador ainda não é assinado digitalmente): clique em **Mais informações → Executar assim mesmo**.

<details>
<summary>Versão de teste, antes do lançamento (para quem acompanha o desenvolvimento)</summary>

1. Abra a aba **Actions** deste repositório no GitHub e clique na execução mais recente do **CI** com sinal verde.
2. No fim da página, em **Artifacts**, baixe `obd2-scanner-windows-instalador`.
3. Descompacte o `.zip` e execute o instalador `OBD2 Scanner_..._x64-setup.exe`.

</details>

Detalhes e solução de problemas: [docs/COMO-USAR.md](docs/COMO-USAR.md).

**Quer ver ou alterar o código sem saber programar?** Comece pelo [guia para iniciantes](docs/GUIA-INICIANTE.md).

## Para desenvolvedores

Requisitos: [Rust](https://rustup.rs), [Node.js 22](https://nodejs.org) e, no Windows, as "Ferramentas de Build do Visual Studio" (C++). Veja os [pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # abre o app em modo de desenvolvimento
npm run tauri build    # gera o instalador em target/release/bundle
cargo test -p obd-core --all-features # testes do núcleo (no Linux, BLE precisa de libdbus-1-dev)
npm test               # testes da interface (testes de desempenho, unidades)
```

Arquitetura: [docs/ARQUITETURA.md](docs/ARQUITETURA.md). Mapa visual de todos os componentes, com diagramas: [docs/DIAGRAMAS.md](docs/DIAGRAMAS.md).

## Créditos e licença

Licença **GPL-3.0-or-later**. Fórmulas conforme SAE J1979 / ISO 15031-5. Partes aproveitadas de projetos abertos
(detalhes em [docs/CREDITOS.md](docs/CREDITOS.md)):

- [pyOBD](https://github.com/alexfare/pyobd) (GPL-2.0-or-later): ~1.900 descrições de códigos genéricos (inglês), detecção rápida da velocidade serial e tentativa de protocolos um por um.
- [AndrOBD](https://github.com/fr3ts0n/AndrOBD) (GPL-3.0): ~2.500 descrições de códigos em português do Brasil; lista de PIDs (`pids.csv`) usada para conferir fórmulas dos parâmetros extras; ideia do modo head-up display.
- [ELMduino](https://github.com/PowerBroker2/ELMduino) (MIT): ideia da leitura rápida (vários parâmetros por pedido).
- [Libre Diagnostic](https://github.com/Libre-Diagnosctic/libre-automotive-diagnostic) (AGPL-3.0): tabelas de códigos específicos de 10 marcas.
- [DDT4ALL](https://github.com/cedricp/ddt4all) (GPL-3.0): ideia do teste de versão real do adaptador e da busca de centrais.
- [obdium](https://github.com/provrb/obdium) (GPL-3.0) e [o3DIAG](https://github.com/openw3rk-DEVELOP/o3DIAG) (MIT): referência de ideias.

---

**English:** OBD2 Scanner is a Rust + Tauri 2 desktop app for ELM327 adapters (genuine or clones) over USB, Bluetooth
classic (COM port), Bluetooth LE, Wi-Fi and a built-in demo simulator. It detects frozen clone adapters (reset and reconfigure),
reconnects by itself when the link drops, keeps per-car profiles (matched by VIN) and offers metric or imperial units.
It shows live data as cards or dials with
explanations, automatic interpretation, alerts, a trip computer, automatic performance tests (0–100, 100–0, 40–80, 80–120 km/h) and a head-up display; charts; trouble codes (read/clear,
freeze frame, 10 brand tables); Mode 06 test results; readiness monitors; VIN decoding; an AT terminal; recording,
playback and export to CSV/JSON/PNG plus a printable report. UI in Brazilian Portuguese and US English with 8 themes.
Download the Windows installer from [Releases](https://github.com/samuvieceli/obd2-scanner/releases/latest).
See `docs/ARQUITETURA.md` (Portuguese) for the design.
