# Arquitetura

> Versão com diagramas de todos os componentes: [DIAGRAMAS.md](DIAGRAMAS.md).

```
┌──────────────────────── Interface (src/, TypeScript + Vite) ────────────────────────┐
│ telas (views/) · textos pt-BR/en-US (locales/) · gráficos uPlot · estado (store.ts) │
│ playback · trip · perf · battery · alerts · prefs · units · gauge · theme · awake   │
└──────────────────────────────── invoke() / eventos ─────────────────────────────────┘
┌──────────────────────── App Tauri (src-tauri/, Rust) ───────────────────────────────┐
│ lib.rs: comandos · worker.rs: thread dona do adaptador, recuperação, reconexão      │
│ recorder.rs: gravação · portable.rs: versão portátil, aviso de WebView2, tela acesa │
└─────────────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────── Núcleo (crates/obd-core, Rust, sem interface) ──────────────┐
│ interpret · session (CSV/JSON) · health (travamento e queda da conexão)            │
│ adapter_test (versão real do ELM327) · ecu_scan (centrais e identificação UDS)      │
│ pid · dtc · vin · readiness · mode06 (decodificadores)                              │
│ response                             (limpeza do texto + quadros CAN ISO-TP)        │
│ elm327                               (protocolo ELM327 tolerante a clones)          │
│ transport: serial (USB/BT COM) · ble (Bluetooth LE) · tcp (Wi-Fi) · simulator      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Decisões principais

- **Núcleo separado da interface.** `obd-core` não depende do Tauri: pode ser testado com `cargo test` em qualquer sistema e reaproveitado (linha de comando, outro app).
- **Uma interface `Transport` para todas as conexões.** Só move bytes (`write_all`, `read` com tempo limite). O BLE (`btleplug`, assíncrono) tem um pequeno runtime Tokio interno e expõe a mesma interface bloqueante; ele escolhe sozinho a característica de escrita e a de notificação (serviços FFF0, FFE0, 18F0 ou qualquer outro com essas propriedades). Fica atrás da feature `ble` do núcleo.
- **O simulador é um transporte.** O modo demonstração recebe os mesmos comandos de texto de um ELM327 real e responde igual, então ele testa o programa inteiro. Com `quirky` ele imita clones (eco que não desliga, `SEARCHING...`, bytes nulos, comandos AT recusados).
- **Tolerância a clones.** Tempos configuráveis; `OK` e eco nunca são exigidos; comandos AT não suportados (`?`) são ignorados e listados em `AdapterInfo::unsupported_at`; resposta sem `>` é aproveitada; velocidade serial automática (38400, 9600, 115200...); pedidos OBD perdidos ou interrompidos (`STOPPED`, `BUFFER FULL`, erro de barramento) são repetidos uma vez, com um `ATI` antes para destravar o adaptador (um CR sozinho faria o ELM327 repetir o último comando); plano B de protocolo um por um; leitura de vários PIDs por pedido com volta automática para um por vez.
- **Uma thread dona do adaptador.** Portas seriais não podem ser usadas por dois lugares. Os comandos da interface viram tarefas na fila da thread e rodam entre as leituras ao vivo, sem travar a janela.
- **Saúde da conexão separada da recuperação.** `health.rs` só classifica cada resposta (válida, suspeita, reinício do adaptador, conexão perdida) e decide a ação; `Elm327::recover` reinicia e reconfigura o adaptador no protocolo já conhecido; `worker.rs` reabre a porta com esperas crescentes (até 3 min), usando uma função `Reopen` criada no `connect` com a mesma porta, velocidade e protocolo. Durante a reconexão a porta antiga é fechada (`transport::Closed`), porque o Windows não deixa abrir a mesma porta COM duas vezes. O simulador imita as falhas (`ATSIMHANG`, `ATSIMRESET`, `ATSIMFREEZE`, `ATSIMDROP`).
- **Ferramentas que mexem nas configurações do adaptador sempre o devolvem como estava.** O teste de compatibilidade (`adapter_test.rs`) e a busca de centrais (`ecu_scan.rs`, que liga os cabeçalhos com `ATH1` e muda o destino com `ATSH`) terminam com `Elm327::reconfigure` (ATZ, configuração e o protocolo já conhecido). Nenhum comando que grava na memória do adaptador (`ATPP`, `ATCV`, `ATSD`, `ATBRD`) nem serviço que escreve na central (UDS 0x2E, 0x31, 0x27...) é usado: só leitura (OBD modos 01/09 e UDS 0x22).
- **Detalhes do Windows.** `transport/bt_ports.rs` lê do registro (só leitura) quais portas COM Bluetooth são de saída (as que funcionam) e o nome do adaptador; `list_ports` as põe primeiro e marca as de entrada como `bluetooth_in`. `awake.ts` chama `keep_awake`, que usa `SetThreadExecutionState` na thread principal enquanto há leitura, gravação ou HUD.
- **Gravação com cópia de segurança.** `recorder.rs` mantém a gravação na memória (exportar e reproduzir é imediato) e escreve, ao mesmo tempo, uma linha JSON por leitura em `gravacao-em-andamento.jsonl` (pasta de dados do app ou pasta portátil), gravada no disco pelo menos a cada minuto. Uma linha `{"end":true}` marca o fim; sem ela, `Recorder::recover` traz a gravação de volta na próxima abertura (uma linha cortada pela queda é ignorada).
- **Perfis e unidades só na interface.** O núcleo trabalha sempre em unidades métricas (as do padrão OBD2). `units.ts` converte apenas na exibição e na digitação de limites; `prefs.ts` guarda os perfis (combustível, cilindrada, alertas, VIN); `fuels.ts` calcula a relação ar/combustível e a densidade de cada combustível a partir da mistura legal (E32, E25, etanol hidratado, B15), ponderada pela massa, então uma mudança na lei só pede um número novo ali e escolhe o perfil pelo VIN ao conectar. Resultados de desempenho levam o `profileId`.
- **Só leitura garantido no código.** O Terminal AT passa cada linha por `safety::check_terminal_command` e envia `safety::normalize` (só ASCII visível, então uma linha nunca leva um segundo comando depois de um CR); comandos AT que gravam no adaptador e serviços que escrevem, testam peças ou reiniciam centrais são recusados antes de sair do programa. `ATCAF0` também é recusado (sem a formatação automática do CAN, um pedido de escrita passaria por leitura). `Elm327::clear_dtcs` pergunta giro (010C) e velocidade (010D) na hora e recusa (`ObdError::Refused("engine_running")`) com o motor girando ou o carro andando, ou (`"engine_unknown"`) se o carro não responder; a tela lê os códigos de novo depois de apagar. No simulador, `ATSIMOFF`/`ATSIMON` desligam e ligam o motor virtual.
- **Textos fora do código Rust.** O núcleo devolve chaves (`coolant_temp`, `mixture_lean_b1`) e a interface traduz. Descrições de DTC ficam em `crates/obd-core/data/dtc_descriptions.json` (pt e en).
- **Cálculos derivados na interface.** Consumo (`trip.ts`), testes de desempenho (`perf.ts`, lógica pura testada com Vitest), testes guiados (`battery.ts` e `o2test.ts`, também lógica pura: etapas, limites e avaliação; a tela `views/guided.ts` só desenha e pede ao trabalhador que leia apenas os valores do teste), alertas (`alerts.ts`) e reprodução de gravações (`playback.ts`) usam os mesmos quadros ao vivo que o painel; por isso funcionam igual com o carro e com uma gravação. A interpretação durante a reprodução usa o mesmo código Rust (`interpret_frames`).
- **Nada carregado da internet.** O gráfico (uPlot) é empacotado no app; a política de segurança (CSP) bloqueia fontes externas.

## Testes

- `crates/obd-core/src/*`: testes de saúde da conexão (`health.rs`), fórmulas, DTC, VIN, prontidão, interpretação, CSV/JSON.
- `crates/obd-core/tests/elm327_integration.rs`: sessão completa contra o simulador (normal e clone), recuperação de adaptador travado, reiniciado, congelado e com conexão caída e respostas gravadas de adaptadores reais (clone sem `OK`, ignição desligada, protocolo ISO 9141 com duas centrais, `STOPPED`/`BUFFER FULL`, comandos AT recusados, Modo 06, leitura rápida).
- `src/units.test.ts` (Vitest): conversão de unidades.
- `src/battery.test.ts` (Vitest): teste de bateria com tensões simuladas (carro saudável, tensão instável, motor ligado na etapa 1, partida não vista, carga inteligente).
- `src/o2test.test.ts` (Vitest): sondas com sinais simulados (catalisador bom e gasto, sonda parada, adaptador lento, sonda de banda larga).
- `src/perf.test.ts` (Vitest): detecção dos testes de desempenho com perfis de velocidade simulados (arrancada, retomadas, frenagem, desistência, falha de leitura, adaptador lento).
- CI (`.github/workflows/ci.yml`): testes no Linux e geração do instalador no Windows.

## Como adicionar

> Ao criar, mudar ou remover um componente, atualize também [DIAGRAMAS.md](DIAGRAMAS.md) no mesmo commit.

- **Um parâmetro (PID):** linha em `PIDS` (`pid.rs`) + textos em `src/locales/*.ts` (`pids`).
- **Um código de falha:** entrada em `dtc_descriptions.json`.
- **Um tema:** bloco `:root[data-theme="nome"]` em `styles.css`, cores de prévia em `THEME_SWATCH` (`theme.ts`) e nome/descrição em `settings.themes`.
- **Uma unidade:** caso em `conversion()` (`units.ts`), opção em `UNIT_CHOICES` e nome em `units.names`.
- **Um idioma:** copie `src/locales/en-US.ts`, traduza e registre em `LANGS` (`src/i18n.ts`).
