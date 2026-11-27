# Arquitetura

```
┌──────────────────────── Interface (src/, TypeScript + Vite) ────────────────────────┐
│ telas (views/) · textos pt-BR/en-US (locales/) · gráficos uPlot · estado (store.ts) │
└──────────────────────────────── invoke() / eventos ─────────────────────────────────┘
┌──────────────────────── App Tauri (src-tauri/, Rust) ───────────────────────────────┐
│ lib.rs: comandos · worker.rs: uma thread dona do adaptador · recorder.rs: gravação  │
└─────────────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────── Núcleo (crates/obd-core, Rust, sem interface) ──────────────┐
│ interpret · session (CSV/JSON)                                                      │
│ pid · dtc · vin · readiness          (decodificadores)                              │
│ response                             (limpeza do texto + quadros CAN ISO-TP)        │
│ elm327                               (protocolo ELM327 tolerante a clones)          │
│ transport: serial (USB/BT COM) · tcp (Wi-Fi) · simulator (demo) · [ble: próximo]   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Decisões principais

- **Núcleo separado da interface.** `obd-core` não depende do Tauri: pode ser testado com `cargo test` em qualquer sistema e reaproveitado (linha de comando, outro app).
- **Uma interface `Transport` para todas as conexões.** Só move bytes (`write_all`, `read` com tempo limite). Adicionar BLE é implementar esse trait.
- **O simulador é um transporte.** O modo demonstração recebe os mesmos comandos de texto de um ELM327 real e responde igual, então ele testa o programa inteiro. Com `quirky` ele imita clones (eco que não desliga, `SEARCHING...`, bytes nulos, comandos AT recusados).
- **Tolerância a clones.** Tempos configuráveis; `OK` e eco nunca são exigidos; comandos AT não suportados (`?`) são ignorados na configuração; resposta sem `>` é aproveitada; velocidade serial automática (38400, 9600, 115200...).
- **Uma thread dona do adaptador.** Portas seriais não podem ser usadas por dois lugares. Os comandos da interface viram tarefas na fila da thread e rodam entre as leituras ao vivo, sem travar a janela.
- **Textos fora do código Rust.** O núcleo devolve chaves (`coolant_temp`, `mixture_lean_b1`) e a interface traduz. Descrições de DTC ficam em `crates/obd-core/data/dtc_descriptions.json` (pt e en).
- **Nada carregado da internet.** O gráfico (uPlot) é empacotado no app; a política de segurança (CSP) bloqueia fontes externas.

## Testes

- `crates/obd-core/src/*`: testes de fórmulas, DTC, VIN, prontidão, interpretação, CSV/JSON.
- `crates/obd-core/tests/elm327_integration.rs`: sessão completa contra o simulador (normal e clone) e respostas gravadas de adaptadores reais (clone sem `OK`, ignição desligada, protocolo ISO 9141 com duas centrais).
- CI (`.github/workflows/ci.yml`): testes no Linux e geração do instalador no Windows.

## Como adicionar

- **Um parâmetro (PID):** linha em `PIDS` (`pid.rs`) + textos em `src/locales/*.ts` (`pids`).
- **Um código de falha:** entrada em `dtc_descriptions.json`.
- **Um idioma:** copie `src/locales/en-US.ts`, traduza e registre em `LANGS` (`src/i18n.ts`).
