# Créditos e material de terceiros

| Origem | Licença | O que foi aproveitado | Onde está |
| --- | --- | --- | --- |
| [pyOBD](https://github.com/alexfare/pyobd) (Donour Sizemore, Secons Ltd., Jure Poljsak, FareBrothers) | GPL-2.0-or-later | Descrições em inglês de ~1.900 códigos genéricos (`obd2_codes.py`) | `crates/obd-core/data/dtc_descriptions.json` (entradas só com `en`) |
| pyOBD / [python-OBD](https://github.com/brendan-w/python-OBD) | GPL-2.0-or-later | Ideia da sonda rápida de baud rate (`\x7F\x7F\r`) e da tentativa de protocolos um por um (`ATTP`) | `transport/serial.rs` (`probe_baud_rate`), `elm327.rs` (`try_protocols_one_by_one`), reescritos em Rust |
| [Libre Diagnostic](https://github.com/Libre-Diagnosctic/libre-automotive-diagnostic) | AGPL-3.0 | Tabelas de códigos específicos por marca (Audi, BMW, Ford, Honda, Hyundai, Kia, Mazda, Nissan, Toyota, Volkswagen) | `crates/obd-core/data/dtc_brands.json` |
| [AndrOBD](https://github.com/fr3ts0n/AndrOBD) (Erwin Scheuch-Heilig e tradutores) | GPL-3.0 | Descrições de ~2.500 códigos em português do Brasil e ~1.500 em inglês (`codes*.properties`); `pids.csv` usado para conferir as fórmulas dos PIDs de vários valores; ideia do modo head-up display | `crates/obd-core/data/dtc_descriptions.json`, `pid.rs`, `src/views/hud.ts` |
| [OBDex](https://github.com/foerbsnavi/OBDex) | dados CC0-1.0 (domínio público) | Títulos em inglês de ~6.250 códigos genéricos mais novos (SAE J2012); os textos em português desses códigos foram escritos para este projeto | `crates/obd-core/data/dtc_descriptions.json` |
| [Wikibooks: WMI](https://en.wikibooks.org/wiki/Vehicle_Identification_Numbers_(VIN_codes)/World_Manufacturer_Identifier_(WMI)) | CC BY-SA 4.0 | Códigos de fabricante do chassi (WMI) e faixas de país | `crates/obd-core/src/vin.rs` |
| [Wikipedia: OBD-II PIDs](https://en.wikipedia.org/wiki/OBD-II_PIDs) | CC BY-SA 4.0 | Tabelas dos PIDs 1C (norma OBD, incluindo OBDBr-1/2/3) e 51 (tipo de combustível) | `src/locales/*.ts` (`obdStandards`, `fuelTypes`) |
| [OBDb](https://github.com/OBDb) (Clutch Engineering e colaboradores) | CC BY-SA 4.0 | Pedidos e fórmulas dos parâmetros do fabricante (modos 21/22) de 8 modelos: Peugeot 208, Jeep Renegade, Honda HR-V e Civic, Toyota Yaris e Corolla, Ford Ranger, Mitsubishi L200 Triton. Só os pedidos de leitura que não exigem sessão de diagnóstico; nomes traduzidos para o português neste projeto (`tools/obdb_names_pt.tsv`). O arquivo de dados continua sob CC BY-SA 4.0. O OBDb pede que quem lança um produto com esses dados avise antes (support@clutch.engineering) | `crates/obd-core/data/maker_params.json`, `maker.rs`, `tools/obdb_import.py` |
| [ELMduino](https://github.com/PowerBroker2/ELMduino) | MIT | Ideia de pedir vários PIDs por requisição (leitura rápida) | `elm327.rs` (`read_pids_multi`), reescrito em Rust |
| [DDT4ALL](https://github.com/cedricp/ddt4all) (Cedric Paille e colaboradores) | GPL-3.0 | Ideia do teste de versão real do adaptador (comandos AT por versão do ELM327, `elm_checker`) e da busca de centrais com identificação (`ecu_scanner`); lista reduzida a comandos seguros e reescrita em Rust | `adapter_test.rs`, `ecu_scan.rs` |
| [obdium](https://github.com/provrb/obdium) | GPL-3.0 | Referência de fórmulas e da ideia de modo demonstração | — |
| [o3DIAG](https://github.com/openw3rk-DEVELOP/o3DIAG) | MIT | Referência de descrições de códigos P | — |
| [uPlot](https://github.com/leeoniya/uPlot) | MIT | Biblioteca de gráficos | dependência npm |

As licenças GPL-2.0-or-later, AGPL-3.0 e CC BY-SA 4.0 são compatíveis (a CC BY-SA 4.0 pode ser incorporada em obra GPLv3); CC0 é domínio público. As licenças GPL-2.0-or-later e AGPL-3.0 são compatíveis com a GPL-3.0-or-later deste projeto (GPLv3, seção 13).
As ~150 descrições em português dos códigos mais comuns foram escritas para este projeto; as demais em português vêm do AndrOBD.
