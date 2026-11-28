# OBD2 Scanner

Scanner OBD2 de código aberto para Windows, feito para adaptadores **ELM327** (originais, clones e simuladores).
Open-source OBD2 scanner for Windows and ELM327 adapters. *(English summary at the end.)*

## O que ele faz

- **Conexão** por USB, Bluetooth clássico (porta COM; a porta certa já vem primeiro na lista, com o nome do adaptador), **Bluetooth LE**, Wi-Fi e **modo demonstração** (carro virtual, sem adaptador). A leitura ao vivo começa ao abrir o Painel ou o HUD, com botão **Pausar/Retomar leitura**. Tolerante aos defeitos comuns dos clones ELM327 (repete pedidos perdidos, avisa quais comandos o adaptador recusa), com **detecção de travamento** do adaptador (reinicia e reconfigura sozinho) e **reconexão automática** quando o Bluetooth ou o cabo cai.
- **Perfis para vários carros**, reconhecidos pelo chassi (VIN), cada um com combustível, cilindrada, alertas e resultados próprios.
- **Unidades** à escolha: km/h ou mph, °C ou °F, kPa, bar ou psi, km ou milhas, km/L, L/100 km ou mpg.
- **Painel ao vivo** com mais de 80 parâmetros (rotação, temperatura, correção de combustível, sondas lambda e de banda larga, turbo, torque, filtro de partículas, hodômetro, tensão da bateria...), cada um com explicação curta, e **parâmetros do fabricante** (piloto, dados do OBDb) para Peugeot 208, Jeep Renegade, Honda HR-V e Civic, Toyota Yaris e Corolla, Ford Ranger e Mitsubishi L200 Triton: temperatura do óleo e do câmbio, marcha engatada e outros, com os não conferidos marcados como experimentais.
- **Cartões ou mostradores com ponteiro**, **alertas** com som quando um valor sai da faixa segura e **computador de bordo** com **Trip A e Trip B** independentes (Iniciar, Pausar e Zerar; consumo médio, velocidade média, distância, combustível, tempo e custo em R$), **ajuste do consumo pelo abastecimento** ("Tanque cheio" e "Abasteci"), resumo ao desligar o motor e histórico de viagens com gasolina × etanol.
- **Testes de desempenho** 0–100, 100–0, 40–80 e 80–120 km/h, uma prova por vez, com detecção automática do início e do fim reais (a retomada só vale partindo de velocidade constante, como numa ultrapassagem), distância e histórico.
- **Testes guiados**: bateria e alternador passo a passo (repouso, partida e carga), comparação das sondas lambda para avaliar o catalisador e mapa de correção de combustível por rotação e carga, com resultado em linguagem simples.
- **Head-up display (HUD)**: até 4 valores enormes em fundo preto, em tela cheia, com opção espelhada para refletir no para-brisa.
- **Interpretação automática** dos dados, sempre como indício e com o que verificar (superaquecimento, válvula termostática, sensores de temperatura do motor e do ar, MAP e MAF incoerentes, mistura pobre/rica, bateria, partida e alternador, marcha lenta alta ou irregular, vácuo fraco, sonda lambda, catalisador), com confirmação por tempo para evitar alarme falso. Os testes da central (Modo 06) também viram indícios: falha de combustão por cilindro, catalisador e sondas.
- **Gráficos** em tempo real, sincronizados, de qualquer parâmetro que o carro informa (e do consumo calculado), com predefinições (mistura, temperaturas, elétrica, consumo, aceleração, turbo) e exportação para imagem PNG.
- **Códigos de falha**: confirmados, pendentes e permanentes, com descrição em português e tabelas de 10 marcas; apagar códigos; quadro congelado; consulta de qualquer código.
- **Testes da central (Modo 06)**: resultados dos autotestes (sondas, catalisador, falhas de combustão...) com aprovado/reprovado, para achar problemas antes da luz de injeção acender.
- **Veículo e prontidão**: chassi (VIN) decodificado, monitores de prontidão, luz de injeção e **lista das centrais** que respondem (motor, câmbio...) com número da peça e versão do software.
- **Teste de compatibilidade do adaptador**: descobre a versão real do ELM327 (clones costumam anunciar mais do que fazem).
- **Terminal AT** para comandos diretos ao adaptador.
- **Gravações e relatórios**: a gravação guarda os sensores e também os códigos de falha, a prontidão e o Modo 06 (lidos no começo e no fim). Exporta CSV (inclusive no formato do Excel brasileiro) e JSON, **reproduz gravações** como se fosse ao vivo, com marcas de evento, e gera, quando você pede, um relatório de diagnóstico a partir da gravação (códigos, prontidão, indícios do trajeto, gráficos e mínimo/média/máximo), para imprimir ou salvar como PDF.
- Interface em **português (Brasil)**, **inglês (EUA)** e **inglês (Europa)**, cada um com as suas unidades (trocar o idioma troca as unidades na hora), 8 temas (automático, escuro, claro, noturno vermelho, alto contraste, oficina, terminal e papel) e **glossário** com todos os termos.

## Baixar e instalar (Windows 10 e 11)

**[⬇ Baixar a versão mais recente](https://github.com/samuvieceli/obd2-scanner/releases/latest)**: na página que abrir, clique em `OBD2-Scanner-...-Windows-instalador.exe` (em *Assets*) e execute o arquivo baixado. O Windows pode avisar que o programa é de um editor desconhecido (o instalador ainda não é assinado digitalmente): clique em **Mais informações → Executar assim mesmo**.

**Sem instalar (versão portátil):** baixe `OBD2-Scanner-...-Windows-portatil.zip`, descompacte numa pasta (pode ser um pendrive) e abra `OBD2-Scanner.exe`. As configurações ficam na pasta `OBD2-Scanner-dados`, ao lado do programa. Precisa do Microsoft Edge WebView2, que já vem no Windows 10 e 11; se faltar, o programa avisa e mostra onde baixar.

<details>
<summary>Versão de teste, antes do lançamento (para quem acompanha o desenvolvimento)</summary>

1. Abra a aba **Actions** deste repositório no GitHub e clique na execução mais recente do **CI** com sinal verde.
2. No fim da página, em **Artifacts**, baixe `obd2-scanner-windows-instalador`.
3. Descompacte o `.zip` e execute o instalador `OBD2 Scanner_..._x64-setup.exe`. A versão portátil está em `obd2-scanner-windows-portatil`.

</details>

Detalhes e solução de problemas: [docs/COMO-USAR.md](docs/COMO-USAR.md).

**Quer ver ou alterar o código sem saber programar?** Comece pelo [guia para iniciantes](docs/GUIA-INICIANTE.md).

## Para desenvolvedores

Requisitos: [Rust](https://rustup.rs), [Node.js 26](https://nodejs.org) e, no Windows, as "Ferramentas de Build do Visual Studio" (C++). Veja os [pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # abre o app em modo de desenvolvimento
npm run tauri build    # gera o instalador em target/release/bundle
cargo test -p obd-core --all-features # testes do núcleo (no Linux, BLE precisa de libdbus-1-dev)
npm test               # testes da interface (desempenho, testes guiados, consumo, trips, abastecimento, relatório...)
```

Base de dados e particularidades dos carros brasileiros (OBDBr, flex, chassi): [docs/CARROS-BRASILEIROS.md](docs/CARROS-BRASILEIROS.md).

Arquitetura: [docs/ARQUITETURA.md](docs/ARQUITETURA.md). Mapa visual de todos os componentes, com diagramas: [docs/DIAGRAMAS.md](docs/DIAGRAMAS.md).

## Créditos e licença

Licença **GPL-3.0-or-later**. Fórmulas conforme SAE J1979 / ISO 15031-5. Partes aproveitadas de projetos abertos
(detalhes em [docs/CREDITOS.md](docs/CREDITOS.md)):

- [pyOBD](https://github.com/alexfare/pyobd) (GPL-2.0-or-later): ~1.900 descrições de códigos genéricos (inglês), detecção rápida da velocidade serial e tentativa de protocolos um por um.
- [AndrOBD](https://github.com/fr3ts0n/AndrOBD) (GPL-3.0): ~2.500 descrições de códigos em português do Brasil; lista de PIDs (`pids.csv`) usada para conferir fórmulas dos parâmetros extras; ideia do modo head-up display.
- [OBDex](https://github.com/foerbsnavi/OBDex) (dados CC0): ~6.250 códigos genéricos mais novos (títulos em inglês; textos em português escritos para este projeto).
- Wikibooks e Wikipedia (CC BY-SA 4.0): códigos de fabricante do chassi e tabelas de norma OBD (OBDBr) e combustível.
- [OBDb](https://github.com/OBDb) (CC BY-SA 4.0): parâmetros do fabricante (Modo 21/22) de 8 modelos (`crates/obd-core/data/maker_params.json`, que continua sob CC BY-SA 4.0).
- [ELMduino](https://github.com/PowerBroker2/ELMduino) (MIT): ideia da leitura rápida (vários parâmetros por pedido).
- [Libre Diagnostic](https://github.com/Libre-Diagnosctic/libre-automotive-diagnostic) (AGPL-3.0): tabelas de códigos específicos de 10 marcas.
- [DDT4ALL](https://github.com/cedricp/ddt4all) (GPL-3.0): ideia do teste de versão real do adaptador e da busca de centrais.
- [obdium](https://github.com/provrb/obdium) (GPL-3.0) e [o3DIAG](https://github.com/openw3rk-DEVELOP/o3DIAG) (MIT): referência de ideias.

---

**English:** OBD2 Scanner is a Rust + Tauri 2 desktop app for ELM327 adapters (genuine or clones) over USB, Bluetooth
classic (COM port), Bluetooth LE, Wi-Fi and a built-in demo simulator. It detects frozen clone adapters (reset and reconfigure),
reconnects by itself when the link drops, keeps per-car profiles (matched by VIN) and offers metric or imperial units.
Live reading starts when the dashboard or HUD opens (Pause/Resume button).
It shows live data as cards or dials with
explanations, automatic interpretation (also from Mode 06 results), alerts, a trip computer with independent Trip A/B and fuel-pump calibration, automatic performance tests (0–100, 100–0, 40–80, 80–120 km/h, one at a time), guided tests (battery and alternator, O2 sensors and catalytic converter, fuel trim map) and a head-up display; charts of any supported parameter with presets; trouble codes (read/clear,
freeze frame, 10 brand tables); Mode 06 test results; readiness monitors; VIN decoding; an AT terminal; recording (sensors plus trouble codes, readiness and Mode 06),
playback and export to CSV/JSON/PNG plus an on-demand printable report built from a recording. UI in Brazilian Portuguese, US English (mph, °F, mpg) and European English (British spelling, km/h, °C, L/100 km), switching units with the language, with 8 themes.
Download the Windows installer from [Releases](https://github.com/samuvieceli/obd2-scanner/releases/latest), or the portable zip (`...-Windows-portatil.zip`) to run without installing; it keeps its settings in a folder next to the program.
See `docs/ARQUITETURA.md` (Portuguese) for the design.
