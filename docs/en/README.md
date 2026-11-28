# OBD2 Scanner

Open-source OBD2 scanner for Windows, made for **ELM327** adapters (genuine ones, clones and simulators).

> The original documents are in Brazilian Portuguese (pt-BR) and live in [README.md](../../README.md) and `docs/`. This folder holds the full English versions (en-US; the in-app English (Europe) version is derived from them with British spelling). When a text changes, update both languages.

## What it does

- **Connection** over USB, Bluetooth classic (COM port; the right port comes first in the list, with the adapter's name), **Bluetooth LE**, Wi-Fi and **demo mode** (a virtual car, no adapter needed). Live reading starts when you open the Dashboard or the HUD, with a **Pause/Resume reading** button. Tolerant of the usual ELM327 clone defects (repeats lost requests, tells you which commands the adapter refuses), with **freeze detection** (resets and reconfigures the adapter by itself) and **automatic reconnection** when Bluetooth or the cable drops.
- **Profiles for several cars**, recognized by the VIN, each with its own fuel, engine size, alerts and results.
- **Units** of your choice: km/h or mph, °C or °F, kPa, bar or psi, km or miles, km/L, L/100 km or mpg.
- **Live dashboard** with more than 80 parameters (RPM, temperature, fuel trim, lambda and wide-band sensors, turbo, torque, particulate filter, odometer, battery voltage...), each with a short explanation, and **manufacturer parameters** (pilot, data from OBDb) for the Peugeot 208, Jeep Renegade, Honda HR-V and Civic, Toyota Yaris and Corolla, Ford Ranger and Mitsubishi L200 Triton: oil and transmission temperature, gear engaged and more, with the unverified ones marked as experimental.
- **Cards or dials with a needle**, **alerts** with sound when a value leaves the safe range, and a **trip computer** with independent **Trip A and Trip B** (Start, Pause and Reset; average consumption, average speed, distance, fuel, time and cost), **consumption calibration from refueling** ("Full tank" and "I refueled"), a summary when the engine stops and a trip history with gasoline × ethanol. The fuels follow the language: Brazil (E32, E25, ethanol, B15), USA (E10, E15, E85, diesel, B20) and Europe/UK (E10, E5, E85, B7, HVO100, LPG).
- **Trip**: one button to start and one to end; shows distance, liters, consumption and cost, where the fuel went (stopped, city, road), economy by speed band, driving style and cold engine, with tips in plain language, a PDF report, a CSV spreadsheet and an image for WhatsApp. You can cut a stretch (for example, the stop at the gas station), compare two trips and run a **pre-trip check** (codes, check engine light, battery or alternator and temperature).
- **Pre-purchase check**: a 5-step assistant for looking at a used car (codes cleared recently, permanent codes, control unit VIN vs document, odometer when the car reports it, battery, mixture, Mode 06 and test drive), with a traffic light (green, yellow, red), a PDF report and comparison between cars. What the car does not answer appears as "not checked", never as green.
- **Performance tests** 0–100, 100–0, 40–80 and 80–120 km/h, one run at a time, with automatic detection of the real start and end (the rolling test only counts when starting from a steady speed, like an passing maneuver), distance and history.
- **Guided tests**: battery and alternator step by step (rest, start and charge), comparison of the lambda sensors to assess the catalytic converter, and a fuel-trim map by RPM and load, with the result in plain language.
- **Head-up display (HUD)**: up to 4 huge values on a black background, full screen, with a mirrored option to reflect on the windshield.
- **Automatic interpretation** of the data, always as a hint and with what to check (overheating, thermostat, engine and air temperature sensors, inconsistent MAP and MAF, lean/rich mixture, battery, starting and alternator, high or rough idle, weak vacuum, lambda sensor, catalytic converter), with time confirmation to avoid false alarms. The control unit tests (Mode 06) also become hints: misfire per cylinder, catalytic converter and sensors.
- **Charts** in real time, synchronized, of any parameter the car reports (and of the calculated consumption), with presets (mixture, temperatures, electrical, consumption, acceleration, turbo) and export to a PNG image.
- **Trouble codes**: confirmed, pending and permanent, with a description in your language and tables for 10 brands; clear codes; freeze frame; look up any code.
- **Control unit tests (Mode 06)**: results of the self-tests (sensors, catalytic converter, misfires...) with pass/fail, to find problems before the check engine light comes on.
- **Vehicle and readiness**: decoded VIN, readiness monitors, check engine light and the **list of control units** that answer (engine, transmission...) with part number and software version.
- **Adapter compatibility test**: finds out the real ELM327 version (clones often claim more than they do).
- **AT terminal** for direct commands to the adapter.
- **Recordings and reports**: a recording keeps the sensors and also the trouble codes, readiness and Mode 06 (read at the start and at the end). It exports CSV (including the Brazilian Excel format) and JSON, **plays recordings back** as if live, with event marks, and, when you ask, builds a diagnostic report from the recording (codes, readiness, hints from the trip, charts and minimum/average/maximum), to print or save as PDF.
- Interface in **Portuguese (Brazil)**, **English (US)** and **English (Europe)**, each with its own units (changing the language changes the units at once), 8 themes (automatic, dark, light, red night, high contrast, workshop, terminal and paper), a **glossary** with all the terms and a **Documentation** screen with the manual, the project rules, the diagrams, the program's data and the licenses, all without internet and in the language you choose.

## Download and install (Windows 10 and 11)

**[⬇ Download the latest version](https://github.com/samuvieceli/obd2-scanner/releases/latest)**: on the page that opens, click `OBD2-Scanner-...-Windows-instalador.exe` (under *Assets*) and run the downloaded file. Windows may warn that the program is from an unknown publisher (the installer is not digitally signed yet): click **More info → Run anyway**.

**Without installing (portable version):** download `OBD2-Scanner-...-Windows-portatil.zip`, unzip it into a folder (it can be a USB stick) and open `OBD2-Scanner.exe`. The settings are kept in the `OBD2-Scanner-dados` folder next to the program. It needs Microsoft Edge WebView2, which already comes with Windows 10 and 11; if it is missing, the program tells you and shows where to download it.

<details>
<summary>Test version, before the release (for those following the development)</summary>

1. Open the **Actions** tab of this repository on GitHub and click the latest **CI** run with a green tick.
2. At the bottom of the page, under **Artifacts**, download `obd2-scanner-windows-instalador`.
3. Unzip the `.zip` and run the installer `OBD2 Scanner_..._x64-setup.exe`. The portable version is in `obd2-scanner-windows-portatil`.

</details>

Details and troubleshooting: [COMO-USAR.md](COMO-USAR.md).

**Want to read or change the code without knowing how to program?** Start with the [beginner's guide](GUIA-INICIANTE.md).

## For developers

Requirements: [Rust](https://rustup.rs), [Node.js 26](https://nodejs.org) and, on Windows, the "Visual Studio Build Tools" (C++). See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # opens the app in development mode
npm run tauri build    # builds the installer in target/release/bundle
cargo test -p obd-core --all-features # core tests (on Linux, BLE needs libdbus-1-dev)
npm test               # interface tests (performance, guided tests, consumption, trips, refueling, report...)
```

Database and particulars of Brazilian cars (OBDBr, flex fuel, VIN): [CARROS-BRASILEIROS.md](CARROS-BRASILEIROS.md).

General project rules (product and way of working): [REGRAS-DO-PROJETO.md](REGRAS-DO-PROJETO.md). All of these documents also appear inside the program, on the **Documentation** screen.

Architecture: [ARQUITETURA.md](ARQUITETURA.md). Visual map of all the components, with diagrams: [DIAGRAMAS.md](DIAGRAMAS.md).

## Credits and license

License **GPL-3.0-or-later**. Formulas according to SAE J1979 / ISO 15031-5. Parts reused from open projects
(details in [CREDITOS.md](CREDITOS.md)):

- [pyOBD](https://github.com/alexfare/pyobd) (GPL-2.0-or-later): ~1,900 generic code descriptions (English), fast serial speed detection and trying protocols one by one.
- [AndrOBD](https://github.com/fr3ts0n/AndrOBD) (GPL-3.0): ~2,500 code descriptions in Brazilian Portuguese; PID list (`pids.csv`) used to check the formulas of the extra parameters; the head-up display idea.
- [OBDex](https://github.com/foerbsnavi/OBDex) (CC0 data): ~6,250 newer generic codes (titles in English; Portuguese texts written for this project).
- Wikibooks and Wikipedia (CC BY-SA 4.0): VIN manufacturer codes and the OBD standard (OBDBr) and fuel tables.
- [OBDb](https://github.com/OBDb) (CC BY-SA 4.0): manufacturer parameters (Mode 21/22) for 8 models (`crates/obd-core/data/maker_params.json`, which stays under CC BY-SA 4.0).
- [ELMduino](https://github.com/PowerBroker2/ELMduino) (MIT): the fast-reading idea (several parameters per request).
- [Libre Diagnostic](https://github.com/Libre-Diagnosctic/libre-automotive-diagnostic) (AGPL-3.0): manufacturer-specific code tables for 10 brands.
- [DDT4ALL](https://github.com/cedricp/ddt4all) (GPL-3.0): the idea of the real adapter version test and of the control unit search.
- [obdium](https://github.com/provrb/obdium) (GPL-3.0) and [o3DIAG](https://github.com/openw3rk-DEVELOP/o3DIAG) (MIT): reference for ideas.
