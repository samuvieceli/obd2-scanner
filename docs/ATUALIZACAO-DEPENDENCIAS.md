# Atualização das dependências (novembro de 2026)

Nota de progresso para retomar o trabalho se ele for interrompido.
Cada etapa é um PR separado, do mais fácil para o mais arriscado.

| Etapa | O que muda | Situação |
|---|---|---|
| 1 | Node.js 22 → 26 LTS, Rust edição 2021 → 2024, Vite 7.3 → 8.4, Vitest 3.2 → 5.1, ações do GitHub v4 → v7 | em andamento |
| 2 | Demais dependências (Cargo.lock e package-lock.json na versão mais nova compatível) | pendente |
| 3 | btleplug 0.11 → 0.13 (Bluetooth BLE) | pendente |
| 4 | TypeScript 5.9 → 7.0 | pendente |

Já estavam na versão mais nova: Tauri 2.12.7, serialport 4.10.1, uPlot 1.6.32,
plugins dialog 2.8.4 e opener 2.7.3, serde, serde_json, thiserror, tokio,
futures, winreg 0.56, windows-sys 0.61, tauri-build 2.7.6.

## Observações por etapa

**Etapa 1.** A edição 2024 do Rust só muda a ordem em que valores temporários
são descartados em alguns pontos (`worker.rs`, `ble.rs`); nenhum deles segura
trava ou recurso, então o comportamento é o mesmo. O Vite 8 não traz mais o
esbuild: a compactação passou para o Oxc, padrão do Vite 8 (`minify: true`).

## Como verificar

- `cargo test -p obd-core --all-features`
- `npm run typecheck`, `npm test`, `npm run build`
- No Windows: `npm run tauri build` (a CI gera o instalador).
