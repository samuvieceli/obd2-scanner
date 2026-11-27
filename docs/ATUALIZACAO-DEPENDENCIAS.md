# Atualização das dependências (novembro de 2026)

Nota de progresso para retomar o trabalho se ele for interrompido.
Cada etapa é um PR separado, do mais fácil para o mais arriscado.

| Etapa | O que muda | Situação |
|---|---|---|
| 1 | Node.js 22 → 26 LTS, Rust edição 2021 → 2024, Vite 7.3 → 8.4, Vitest 3.2 → 5.1, ações do GitHub v4 → v7 | feito (PR #19) |
| 2 | Demais dependências (Cargo.lock e package-lock.json na versão mais nova compatível) | nada a fazer: já estavam todas na mais nova |
| 3 | btleplug 0.11 → 0.13 (Bluetooth BLE) | feito (PR #20) |
| 4 | TypeScript 5.9 → 7.0 | feito |

Já estavam na versão mais nova: Tauri 2.12.7, serialport 4.10.1, uPlot 1.6.32,
plugins dialog 2.8.4 e opener 2.7.3, serde, serde_json, thiserror, tokio,
futures, winreg 0.56, windows-sys 0.61, tauri-build 2.7.6.

## Observações por etapa

**Etapa 1.** A edição 2024 do Rust só muda a ordem em que valores temporários
são descartados em alguns pontos (`worker.rs`, `ble.rs`); nenhum deles segura
trava ou recurso, então o comportamento é o mesmo. O Vite 8 não traz mais o
esbuild: a compactação passou para o Oxc, padrão do Vite 8 (`minify: true`).

**Etapa 3.** O btleplug 0.13 não mudou nada do que o programa usa (as
mudanças que quebram compatibilidade são em Android e em tipos que não
usamos). Traz correções importantes no Windows: travamento quando duas
operações rodavam ao mesmo tempo, falha de tudo depois de reconectar um
adaptador que caiu, e busca de dispositivos que podia não achar aparelhos
comuns. O código compila e passa no clippy também para Windows.
Só dá para confirmar de verdade com um adaptador BLE real (ver lista abaixo).

**Etapa 4.** O TypeScript 7 foi reescrito em Go e verifica o código cerca de
10 vezes mais rápido. Ele passou a conferir também as importações de arquivos
CSS; para isso o arquivo `src/vite-env.d.ts` diz a ele que o Vite cuida
desses arquivos. Nenhum outro ajuste foi preciso, e ele continua acusando
erros de tipo normalmente.

## Como testar o Bluetooth BLE com um adaptador real

1. Ligue a ignição e o adaptador; abra o programa e escolha "Bluetooth LE".
2. Clique em procurar: o adaptador deve aparecer no topo da lista.
3. Conecte: deve mostrar a versão do ELM327 e o protocolo do carro.
4. Abra o painel ao vivo por 1 a 2 minutos: os valores devem atualizar sem travar.
5. Desligue e religue o adaptador (ou afaste-se): o programa deve avisar e reconectar.
6. Leia os códigos de falha (DTC) e desconecte.

## Como verificar

- `cargo test -p obd-core --all-features`
- `npm run typecheck`, `npm test`, `npm run build`
- No Windows: `npm run tauri build` (a CI gera o instalador).
