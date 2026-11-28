#!/usr/bin/env python3
"""Builds crates/obd-core/data/maker_params.json from OBDb signal sets.

OBDb (https://github.com/OBDb) publishes, for each car model, the
manufacturer requests (services 21/22) a scan tool can send and how to decode
the answers. License: CC BY-SA 4.0 (see docs/CREDITOS.md).

Usage:
    git clone --depth 1 https://github.com/OBDb/Toyota-Corolla obdb/Toyota-Corolla
    ...
    python3 tools/obdb_import.py obdb/

Only requests that read are kept: service 21 or 22, sent straight to one
control unit. Requests that need a diagnostic session first (`din`/`dout`),
extended addressing (`eax`, `tst`) or another CAN priority (`pri`) are left
out, so the program never changes the state of a control unit.

Names are translated to Portuguese with tools/obdb_names_pt.tsv
(English<TAB>Portuguese). Names missing there are listed in
tools/obdb_names_missing.txt and kept in English until translated.
"""

import json
import os
import re
import sys

# Pilot: models sold in Brazil whose OBDb data is mostly confirmed on real cars.
MODELS = [
    ("Peugeot-208", "peugeot-208", "Peugeot", "208"),
    ("Jeep-Renegade", "jeep-renegade", "Jeep", "Renegade"),
    ("Honda-HR-V", "honda-hr-v", "Honda", "HR-V"),
    ("Honda-Civic", "honda-civic", "Honda", "Civic"),
    ("Toyota-Yaris", "toyota-yaris", "Toyota", "Yaris"),
    ("Toyota-Corolla", "toyota-corolla", "Toyota", "Corolla"),
    ("Ford-Ranger", "ford-ranger", "Ford", "Ranger"),
    ("Mitsubishi-Triton", "mitsubishi-triton", "Mitsubishi", "L200 Triton"),
]

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "crates", "obd-core", "data", "maker_params.json")
NAMES = os.path.join(HERE, "obdb_names_pt.tsv")
MISSING = os.path.join(HERE, "obdb_names_missing.txt")

# OBDb unit -> (unit shown by the program, factor, offset): value in the
# program's unit = value * factor + offset. Everything ends up metric.
UNITS = {
    "celsius": ("°C", 1, 0),
    "fahrenheit": ("°C", 1 / 1.8, -32 / 1.8),
    "kilopascal": ("kPa", 1, 0),
    "bars": ("kPa", 100, 0),
    "psi": ("kPa", 6.894757, 0),
    "kilometersPerHour": ("km/h", 1, 0),
    "kilometers": ("km", 1, 0),
    "miles": ("km", 1.609344, 0),
    "volts": ("V", 1, 0),
    "millivolts": ("mV", 1, 0),
    "percent": ("%", 1, 0),
    "rpm": ("rpm", 1, 0),
    "degrees": ("°", 1, 0),
    "newtonMeters": ("Nm", 1, 0),
    "seconds": ("s", 1, 0),
    "milliseconds": ("ms", 1, 0),
    "minutes": ("min", 1, 0),
    "hours": ("h", 1, 0),
    "amps": ("A", 1, 0),
    "milliamps": ("mA", 1, 0),
    "ohms": ("Ω", 1, 0),
    "milliohms": ("mΩ", 1, 0),
    "megaohms": ("MΩ", 1, 0),
    "liters": ("L", 1, 0),
    "gallons": ("L", 3.785412, 0),
    "gramsPerSecond": ("g/s", 1, 0),
    "metersPerSecondSquared": ("m/s²", 1, 0),
    "gravity": ("g", 1, 0),
    "ampereHours": ("Ah", 1, 0),
    "kilowatts": ("kW", 1, 0),
    "watts": ("W", 1, 0),
    "millimeters": ("mm", 1, 0),
    "gramsPerLiter": ("g/L", 1, 0),
    "hertz": ("Hz", 1, 0),
    "scalar": ("", 1, 0),
    "unknown": ("", 1, 0),
}

# On/off style units: the first word is the meaning of 0 (OBDb convention,
# e.g. "offon": 0 = off, 1 = on, like the MIL bit of SAE J1979).
STATES = {
    "offon": ["off", "on"],
    "onoff": ["on", "off"],
    "noyes": ["no", "yes"],
    "yesno": ["yes", "no"],
}

UNSAFE = ("din", "dout", "eax", "tst", "pri")

# Placeholders OBDb keeps while a request is studied ("Raw first byte of
# 0E 22 2300"): they mean nothing to a driver.
SKIP_NAME = re.compile(r"^Raw first byte of ")

# Numbered families of names, translated once: (English regex, Portuguese).
PATTERNS = [
    (r"HV battery cell #0?(\d+) voltage", r"Tensão da célula \1 da bateria de alta tensão"),
    (r"Individual cell voltage A(\d+)", r"Tensão da célula A\1"),
    (r"Internal resistance R?(\d+)", r"Resistência interna \1"),
    (r"HV battery block (\d+) voltage", r"Tensão do bloco \1 da bateria de alta tensão"),
    (r"HV battery block (\d+) internal resistance", r"Resistência interna do bloco \1 da bateria de alta tensão"),
    (r"(?:HV|Hybrid) battery temperature (\d+)", r"Temperatura \1 da bateria de alta tensão"),
    (r"Temperature of battery (\d+)", r"Temperatura da bateria \1"),
    (r"Misfire count #?(\d+),,? variant (\d+)", r"Falhas de combustão nº \1, variante \2"),
    (r"Misfire count #?(\d+)", r"Falhas de combustão nº \1"),
    (r"Misfire count, cylinder (\d+)", r"Falhas de combustão, cilindro \1"),
    (r"Misfire acceleration, cylinder (\d+)", r"Aceleração na falha de combustão, cilindro \1"),
    (r"Knock counter, cylinder (\d+)", r"Contador de detonação, cilindro \1"),
    (r"Rough idle, cylinder (\d+)", r"Marcha lenta irregular, cilindro \1"),
    (r"Idle spark advance control,? (?:cylinder )?(\d+)", r"Controle do avanço de ignição na lenta, cilindro \1"),
    (r"Injection feedback value (\d+)", r"Valor de correção da injeção \1"),
    (r"Injection volume (\d+)", r"Volume injetado \1"),
    (r"Transmission fluid temperature, variant (\d+)", r"Temperatura do fluido do câmbio, variante \1"),
    (r"Number of gear engagements (\d+)", r"Número de engates da marcha \1"),
    (r"Linear solenoid (\w+) duty", r"Ciclo do solenoide linear \1"),
    (r"System main relay (\d+)", r"Relé principal do sistema \1"),
]


def year_filter(f):
    if not f:
        return None
    return {k: f[k] for k in ("from", "to", "years") if k in f}


def load_names():
    names = {}
    if os.path.exists(NAMES):
        with open(NAMES, encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if line and not line.startswith("#"):
                    en, pt = line.split("\t")
                    names[en] = pt
    return names


def main(root):
    names = load_names()
    missing = set()

    def pt(text):
        if text in names:
            return names[text]
        for en, out in PATTERNS:
            if re.fullmatch(en, text):
                return re.sub(en, out, text)
        missing.add(text)
        return text

    models = []
    seen_keys = set()
    for folder, mid, make, model in MODELS:
        path = os.path.join(root, folder, "signalsets", "v3", "default.json")
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        commands = []
        for c in data["commands"]:
            if any(k in c for k in UNSAFE):
                continue
            (svc, ident), = c["cmd"].items()
            if svc not in ("21", "22") or len(c["hdr"]) not in (3, 4):
                continue
            signals = []
            for s in c["signals"]:
                if SKIP_NAME.match(s["name"]):
                    continue
                fmt = s["fmt"]
                key = "mfr_" + s["id"].lower()
                assert key not in seen_keys, key
                seen_keys.add(key)
                sig = {
                    "key": key,
                    "name": s["name"],
                    "name_pt": pt(s["name"]),
                    "group": s.get("path", "").split(".")[0],
                    "bix": fmt.get("bix", 0),
                    "len": fmt["len"],
                }
                if fmt.get("sign"):
                    sig["sign"] = True
                if fmt.get("blsb"):
                    sig["blsb"] = True
                unit = fmt.get("unit", "")
                states = None
                if "map" in fmt:
                    states = [
                        {"raw": int(k), "en": v["description"], "pt": pt(v["description"])}
                        for k, v in sorted(fmt["map"].items(), key=lambda kv: int(kv[0]))
                    ]
                elif unit in STATES:
                    states = [{"raw": i, "word": w} for i, w in enumerate(STATES[unit])]
                if states is not None:
                    sig.update(unit="", states=states, min=0, max=(1 << fmt["len"]) - 1)
                else:
                    shown, k, off = UNITS[unit]
                    factor = fmt.get("mul", 1) / fmt.get("div", 1) * k
                    add = fmt.get("add", 0) * k + off
                    sig.update(unit=shown, factor=factor, add=add)
                    # Limits in OBDb units, converted like the value.
                    sig["min"] = fmt.get("min", 0) * k + off
                    sig["max"] = fmt["max"] * k + off
                    for b in ("nullmin", "nullmax"):
                        if b in fmt:
                            sig[b] = fmt[b] * k + off
                signals.append(sig)
            if not signals:
                continue
            cmd = {"hdr": c["hdr"], "svc": int(svc, 16), "id": ident.upper(), "signals": signals}
            if c.get("rax"):
                cmd["rax"] = c["rax"]
            if c.get("fcm1"):
                cmd["fc"] = True
            if c.get("dbg"):
                cmd["dbg"] = True
            if year_filter(c.get("dbgfilter")):
                cmd["dbg_years"] = year_filter(c["dbgfilter"])
            if year_filter(c.get("filter")):
                cmd["years"] = year_filter(c["filter"])
            commands.append(cmd)
        entry = {"id": mid, "make": make, "model": model, "commands": commands}
        # Other files describe other generations ("2005-2018.json"): for
        # those model years the default data is not confirmed.
        other = []
        for name in sorted(os.listdir(os.path.dirname(path))):
            m = re.fullmatch(r"(\d{4})-(\d{4})\.json", name)
            if m:
                other.append([int(m.group(1)), int(m.group(2))])
        if other:
            entry["other_years"] = other
        models.append(entry)

    out = {
        "source": "OBDb (https://github.com/OBDb), CC BY-SA 4.0",
        "models": models,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    if missing:
        with open(MISSING, "w", encoding="utf-8") as fh:
            fh.write("".join(f"{m}\n" for m in sorted(missing)))
    elif os.path.exists(MISSING):
        os.remove(MISSING)
    total = sum(len(c["signals"]) for m in models for c in m["commands"])
    print(f"{len(models)} models, {total} parameters, {len(missing)} names without translation")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "obdb")
