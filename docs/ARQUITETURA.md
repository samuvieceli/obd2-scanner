# Arquitetura

```
┌──────────────────────── Interface (src/, TypeScript + Vite) ────────────────────────┐
│ telas (views/) · textos pt-BR/en-US (locales/) · gráficos uPlot · estado (store.ts) │
│ playback · trip (consumo) · alerts · prefs · gauge · theme                          │
└──────────────────────────────── invoke() / eventos ─────────────────────────────────┘
┌──────────────────────── App Tauri (src-tauri/, Rust) ───────────────────────────────┐
│ lib.rs: comandos · worker.rs: uma thread dona do adaptador · recorder.rs: gravação  │
└─────────────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────── Núcleo (crates/obd-core, Rust, sem interface) ──────────────┐
│ interpret · session (CSV/JSON)                                                      │
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
- **Tolerância a clones.** Tempos configuráveis; `OK` e eco nunca são exigidos; comandos AT não suportados (`?`) são ignorados e listados em `AdapterInfo::unsupported_at`; resposta sem `>` é aproveitada; velocidade serial automática (38400, 9600, 115200...); pedidos OBD perdidos ou interrompidos (`STOPPED`, `BUFFER FULL`, erro de barramento) são repetidos uma vez, com um CR antes para destravar o adaptador; plano B de protocolo um por um; leitura de vários PIDs por pedido com volta automática para um por vez.
- **Uma thread dona do adaptador.** Portas seriais não podem ser usadas por dois lugares. Os comandos da interface viram tarefas na fila da thread e rodam entre as leituras ao vivo, sem travar a janela.
- **Textos fora do código Rust.** O núcleo devolve chaves (`coolant_temp`, `mixture_lean_b1`) e a interface traduz. Descrições de DTC ficam em `crates/obd-core/data/dtc_descriptions.json` (pt e en).
- **Cálculos derivados na interface.** Consumo (`trip.ts`), alertas (`alerts.ts`) e reprodução de gravações (`playback.ts`) usam os mesmos quadros ao vivo que o painel; por isso funcionam igual com o carro e com uma gravação. A interpretação durante a reprodução usa o mesmo código Rust (`interpret_frames`).
- **Nada carregado da internet.** O gráfico (uPlot) é empacotado no app; a política de segurança (CSP) bloqueia fontes externas.

## Testes

- `crates/obd-core/src/*`: testes de fórmulas, DTC, VIN, prontidão, interpretação, CSV/JSON.
- `crates/obd-core/tests/elm327_integration.rs`: sessão completa contra o simulador (normal e clone) e respostas gravadas de adaptadores reais (clone sem `OK`, ignição desligada, protocolo ISO 9141 com duas centrais, `STOPPED`/`BUFFER FULL`, comandos AT recusados, Modo 06, leitura rápida).
- CI (`.github/workflows/ci.yml`): testes no Linux e geração do instalador no Windows.

## Como adicionar

- **Um parâmetro (PID):** linha em `PIDS` (`pid.rs`) + textos em `src/locales/*.ts` (`pids`).
- **Um código de falha:** entrada em `dtc_descriptions.json`.
- **Um tema:** bloco `:root[data-theme="nome"]` em `styles.css`, cores de prévia em `THEME_SWATCH` (`theme.ts`) e nome/descrição em `settings.themes`.
- **Um idioma:** copie `src/locales/en-US.ts`, traduza e registre em `LANGS` (`src/i18n.ts`).
