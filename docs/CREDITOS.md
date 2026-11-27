# Créditos e material de terceiros

| Origem | Licença | O que foi aproveitado | Onde está |
| --- | --- | --- | --- |
| [pyOBD](https://github.com/alexfare/pyobd) (Donour Sizemore, Secons Ltd., Jure Poljsak, FareBrothers) | GPL-2.0-or-later | Descrições em inglês de ~1.900 códigos genéricos (`obd2_codes.py`) | `crates/obd-core/data/dtc_descriptions.json` (entradas só com `en`) |
| pyOBD / [python-OBD](https://github.com/brendan-w/python-OBD) | GPL-2.0-or-later | Ideia da sonda rápida de baud rate (`\x7F\x7F\r`) e da tentativa de protocolos um por um (`ATTP`) | `transport/serial.rs` (`probe_baud_rate`), `elm327.rs` (`try_protocols_one_by_one`), reescritos em Rust |
| [Libre Diagnostic](https://github.com/Libre-Diagnosctic/libre-automotive-diagnostic) | AGPL-3.0 | Tabelas de códigos específicos por marca (Audi, BMW, Ford, Honda, Hyundai, Kia, Mazda, Nissan, Toyota, Volkswagen) | `crates/obd-core/data/dtc_brands.json` |
| [AndrOBD](https://github.com/fr3ts0n/AndrOBD) (Erwin Scheuch-Heilig e tradutores) | GPL-3.0 | Descrições de ~2.500 códigos em português do Brasil e ~1.500 em inglês (`codes*.properties`) | `crates/obd-core/data/dtc_descriptions.json` |
| [ELMduino](https://github.com/PowerBroker2/ELMduino) | MIT | Ideia de pedir vários PIDs por requisição (leitura rápida) | `elm327.rs` (`read_pids_multi`), reescrito em Rust |
| [obdium](https://github.com/provrb/obdium) | GPL-3.0 | Referência de fórmulas e da ideia de modo demonstração | — |
| [o3DIAG](https://github.com/openw3rk-DEVELOP/o3DIAG) | MIT | Referência de descrições de códigos P | — |
| [uPlot](https://github.com/leeoniya/uPlot) | MIT | Biblioteca de gráficos | dependência npm |

As licenças GPL-2.0-or-later e AGPL-3.0 são compatíveis com a GPL-3.0-or-later deste projeto (GPLv3, seção 13).
As ~150 descrições em português dos códigos mais comuns foram escritas para este projeto; as demais em português vêm do AndrOBD.
