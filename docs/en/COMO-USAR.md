# How to use OBD2 Scanner

## First of all: the safety notice

The first time the program opens, the window **Before you start: safety** appears, with six points: do not use it while driving (a passenger operates it), performance tests only in a closed and safe place, a diagnosis is a hint and does not replace a mechanic, the program only reads (the only action is clearing trouble codes when you ask), secure the adapter and cables away from the pedals, and use at your own risk (GPL-3.0, no warranty). You can switch the language right there. Click **I have read and agree** to continue; **I do not agree** closes the program. The window only comes back if the text of the notice changes in something important. To read it again: **Settings → About → Safety notice**.

## 1. First test, without a car

1. Open the program. The **Connection** screen already has **Demo** selected.
2. Click **Connect**.
3. Go to **Live dashboard**. Reading starts by itself and the values of a virtual car appear.
4. Explore **Charts**, **Trouble codes** (the virtual car has faults on purpose) and **Vehicle & readiness**.

The **First steps** box at the top of the Connection screen sums up this path, with buttons that lead to each screen. Click **Got it, hide** when you no longer need it; the **Show the first steps** link brings the box back.

**Search:** press **Ctrl+F** (or **Ctrl+K**, or the **Search** button at the top) on any screen and type part of a name: a screen ("charts"), a parameter ("temperature", "sensor"), a glossary term ("closed loop") or a trouble code ("P0301"). Accents don't matter. Use ↑ ↓ and **Enter** to open; **Esc** closes. Parameters and terms open in the Glossary; codes open the lookup on the Trouble codes screen, even with no car connected; sections of the manuals open on the Documentation screen.

The option *Simulate a faulty clone adapter* imitates a cheap adapter that answers in a messy way. It is for testing.

### When reading starts and how to pause

Connecting only opens the conversation with the adapter; the program does not yet keep asking the car for values. **Live reading** (asking for the values several times per second) starts when you open the **Live dashboard** or the **HUD**. On these two screens there is the **Pause reading** button; after pausing, it becomes **Resume reading**. While it is paused, opening the Dashboard or the HUD again does not start reading by itself: only the Resume button (or a new connection) does.

Once started, reading continues when you change screens, so the **Charts**, the **Trip computer** (Trip A and Trip B), the alerts and the recording keep receiving data. Some functions turn reading on by themselves because they do not work without it: **Record**, the **Mini window**, the **Guided tests** and the **Performance tests** (these two put reading back as it was when you leave the screen). The Trip computer only counts while there is reading: with reading paused, the trips stand still too.

## 2. With the car and a classic Bluetooth adapter

1. Plug the adapter into the car's OBD connector (usually under the dashboard, near the pedals) and **turn the ignition on**.
2. In Windows: **Settings → Bluetooth & devices → Add device → Bluetooth**. Choose the adapter (common names: `OBDII`, `OBD2`, `V-LINK`, `Vgate`). PIN: `1234` or `0000`.
3. In the program, choose **USB / Bluetooth**, click **Refresh** and choose the COM port marked **Bluetooth**, which already comes first in the list, with the adapter's name beside it. Windows creates two ports for each paired adapter: the other one appears at the end as **incoming Bluetooth, do not use**, because it never answers.
4. Leave the speed on **Automatic** and click **Connect**.

> If the adapter does not appear in Windows' Bluetooth list, it is probably **Bluetooth LE**: see the next section.

## 2b. Bluetooth LE adapter (iPhone models)

No need to pair in Windows. Choose **Bluetooth LE**: the search starts by itself and lasts about 5 seconds (**Search again** repeats it). Choose the adapter in the list (common names: `IOS-Vlink`, `OBDII`, `Vgate iCar Pro`, `Veepeak`) and click **Connect**. If it does not appear, turn the ignition on, bring the computer closer and close any phone apps that may be connected to it.

**To check a new BLE adapter** (worth doing once):

1. Turn the ignition and the adapter on; open the program and choose **Bluetooth LE**.
2. Wait for the search (or click **Search again**): the adapter should appear at the top of the list.
3. Connect: it should show the ELM327 version and the car's protocol.
4. Leave the live dashboard open for 1 to 2 minutes: the values should update without freezing.
5. Switch the adapter off and on again (or move away): the program should warn you and reconnect.
6. Read the trouble codes (DTC) and disconnect. If a manufacturer-specific code that the program does not know appears (common in Fiat, Chevrolet, Renault, Peugeot/Citroën and Jeep), a notice explains where to look for its meaning: a search with make and model, the service manual, the dealership or a brand workshop.

## 3. USB adapter

Install the driver of the cable's chip (usually FTDI, CH340 or CP2102), plug it in and choose the COM port marked **USB**.

## 4. Wi-Fi adapter

Connect the computer to the adapter's Wi-Fi network (e.g. `WiFi_OBDII`). Use the IP `192.168.0.10` and port `35000` (the default for most). Some use `192.168.4.1` port `35000`.

## 5. Head-up display (HUD)

On the **Head-up display (HUD)** screen, choose up to 4 parameters (they come from the Live dashboard list) and click **Full screen**. The values appear huge on a black background, easy to read at a glance. **Esc** leaves full screen. Turn on **Mirrored** if you will rest the screen on the car's dashboard to reflect on the windshield at night (the image is flipped so it reads correctly in the reflection). For safety, place the screen before you drive off.

**Mini window:** the **Mini window** button on the HUD shrinks the program into a small window that stays **on top of the others** (map, music, call), with the same 3 or 4 values chosen on the HUD. If reading is stopped, it starts by itself. Move the window by the bar at the top; **Back** (or **Esc**) restores the previous size and place.

## 6. Trip computer, alerts and dials

- On the **Live dashboard**, the **Cards / Dials** button switches between big numbers and dials with a needle.
- **Ready-made layouts**: one click chooses the parameters for each situation. **Full** shows everything the car reports; clicking an already chosen layout again also goes back to Full. **Daily** (speed, RPM, temperature, battery, fuel), **Trip** (fuel, engine load and what the trip computer needs), **Injection** (fuel trims, lambda sensors, timing advance, MAP or MAF) and **Turbo / performance** (turbo or manifold pressure, air temperature, timing advance, throttle). Parameters the car does not report are left out automatically; **Choose parameters** still works to build your own. It has a search (accents and capitals do not matter), and the parameters the car does not report stay hidden until you tick **Also show the ones this car does not report**.
- **Manufacturer parameters (pilot)**: at the end of **Choose parameters**, choose the car's model (the VIN suggests the brand). Extra readings from the carmaker appear, such as oil and transmission temperature and gear engaged; tick the ones you want and they become cards like the others (also in charts and recordings). For now: Peugeot 208, Jeep Renegade, Honda HR-V and Civic, Toyota Yaris and Corolla, Ford Ranger and Mitsubishi L200 Triton, only on cars with the CAN protocol. The data comes from the open OBDb project: the **verified** ones were confirmed on a real car (sometimes from another country or with another engine, so compare with a value you know); the **experimental** ones stay hidden until you tick **Show experimental parameters**. Each one is an extra request per cycle, so choosing many makes reading slower. In demo mode, choose **Toyota Corolla** and tick **Engine oil temperature** or **Transmission temperature, sump**.
- Beside the title appears the badge **Engine cold** (coolant below 60 °C), **Warming up** (60 to 80 °C, or oil below 70 °C when the car reports it) or **Engine ready**. With a cold engine, avoid accelerating hard. The same badge appears in the corner of the HUD.
- The **Trip computer** box shows the consumption right now and the trip average in km/L. The program picks by itself the most accurate calculation the car allows, in this order: **fuel flow rate** reported by the control unit (the most accurate, but rare), **MAF sensor** (the air entering the engine, very accurate) or, on cars with only a **MAP sensor** (manifold pressure, common in Brazil), an estimate from the engine size and the volumetric efficiency. Which one your car uses appears in the profile, under **Settings → Vehicles (profiles)**, on the line **Fuel use calculated from**. To improve accuracy, enter the fuel there and, on MAP-only cars, the engine size.
- **Calibrate at the pump** (MAP-only cars; on MAF cars it is inside **Advanced**, for a dirty or old MAF sensor): corrects the calculated consumption by comparing it with the pump.
  **Important:** both times, fill the tank and stop at the **first click-off of the pump**, without topping up. If one of the fill-ups is partial or has a "dribble", the tank is not at the same level and the comparison comes out wrong. The program reminds you of this when you click the buttons.
  1. Fill the tank, stopping at the first click-off of the pump, and click **Tank full** on the trip computer. The program starts adding up the liters it calculates.
  2. Drive normally with the program reading the car, preferably 200 km or more. Whatever is driven with the program off stays out of the calculation and spoils the comparison.
  3. At the next fill-up, fill the tank again, stopping at the first click-off, and click **Refueled**. A window shows the km and the liters calculated since the full tank and asks for the pump's liters.
  4. The program compares the two. Example: pump 20 L, program 18 L, it was 11% low and starts correcting that. On MAP-only cars, what changes is the volumetric efficiency; on MAF cars, a correction factor.
  Each fill-up refines the adjustment (average of the last 5, weighted by km), and the count for the next tank starts by itself. Short stretches (under 50 km or 3 L calculated), with missing readings or with an unexpected result are ignored, with a notice. A badge shows how many fill-ups have already calibrated the consumption, and **Restore defaults** in the profile undoes everything. Cars that report the fuel flow rate do not need this calibration.
- The trip computer has two independent trips, **Trip A** and **Trip B**, as on the car's dashboard. Each has the buttons **Start**, **Pause** and **Reset** (reset asks for confirmation) and shows average consumption, average speed (distance divided by the counted time, including stops with the engine on), distance, fuel used, time and cost. They only count while the program is reading the car, are saved when you close the program and are separate for each car (profile). Example: leave Trip A counting since the last fill-up and use Trip B for a specific journey. The consumption right now is a single one for both. When playing back a recording, a trip of its own for the recording appears, which does not touch Trip A or Trip B.
- Available fuels, with the blends in force in November 2026. The list changes with the region, which follows the language and can be changed under **Settings → Vehicles (profiles) → Fuels of**:
  - **Brazil**: **regular or additive gasoline** (32% ethanol), **premium gasoline** (25% ethanol), **regular or additive ethanol**, **diesel S10 or S500** (15% biodiesel) and **ethanol-free gasoline** (for cars used outside Brazil).
  - **United States**: **regular**, **midgrade** and **premium** gasoline (87, 89 and 91 to 93 octane, all E10, with up to 10% ethanol), **E15** ("Unleaded 88"), **E85 / Flex Fuel** (51% to 83% ethanol depending on the season; the calculation uses 75%), **ethanol-free gasoline (E0)**, **diesel** (up to 5% biodiesel) and **B20 biodiesel**.
  - **Europe and UK**: **E10** (95 octane, the standard gasoline), **E5 super** (97 to 99 octane), **E85** (France, Sweden and others; 75% in the calculation), **B7 diesel** (up to 7% biodiesel), **HVO100** (renewable diesel) and **LPG / autogas**.
  - In all of them, **automatic flex**: uses the ethanol percentage reported by the car and, if the car does not report it, assumes the region's regular gasoline. Additives and octane rating do not change the calculation (only the amount of ethanol or biodiesel does).
  - When changing region (or language), each car moves to the fuel of the same kind sold there: regular gasoline becomes regular E10 in the USA and E10 in Europe, diesel stays diesel, flex stays flex. If there is no equivalent (LPG in Brazil), the car keeps what it had. No profile is deleted.
- **Trip summary**: when the engine stops (or the connection ends) after at least 2 minutes with the engine on, a box opens with the time moving and stopped with the engine on, distance, average and maximum speed, maximum RPM, maximum engine temperature, lowest battery voltage with the engine on, fuel, consumption, cost and the values that went out of the alert range. **Copy image** sends the summary through WhatsApp. The last summary can be opened again with the **See the last trip summary** button on the trip computer (until you close the program).
- **Trip history**: each summary is saved on the **Trip → Trip history** screen, separated by car (profile), with the fuel chosen in Settings. The table compares the real average consumption with gasoline and with ethanol (on a flex car with an ethanol sensor, the percentage read decides the group). There are also **monthly totals** (distance, liters, consumption and cost) and the list of trips, each with a **Delete** button. Playing back a recording does not enter the history.
- **Trip cost**: under **Settings → Fuel prices**, enter the price per liter. Each region has its own price fields and its own currency (R$ in Brazil, $ in the USA, € in Europe and the UK); the prices of a region stay saved when you switch to another. The trip computer then shows the trip cost and, on gasoline, ethanol or flex cars, how much the same trip would cost with the region's regular gasoline and with ethanol (E85 in the USA and Europe). The comparison keeps the same energy: a liter of ethanol has about 70% of the energy of a liter of regular gasoline (E32), hence the rule "ethanol pays off up to 70% of the gasoline price" (E85 against E10 gives about 75%). Engines do a little better on ethanol, so it is an estimate. On automatic flex, the tank's price is the mix of the two according to the ethanol percentage the car reports.
- **Alerts** (in **Settings**): warn with a message and a sound when, for example, the temperature goes above 110 °C or the battery drops below 11.8 V with the engine on. You can change the limits and include other parameters.

## 6a. Trip: analyzing the fuel use of a journey

The **Trip** screen is for understanding how much a route cost and why, without having to build a dashboard or choose parameters.

1. Connect to the car, open **Trip** and press **Start trip** when you set off. The program starts reading by itself what the analysis needs and keeps one line per second. You can use the other screens freely.
2. When you arrive, press **End trip**. The analysis opens right away (trips with less than 1 minute of data are not kept).
3. Give it a name and a note, if you like (e.g. "Drive to the beach", "A/C on").

What the analysis shows:

- **Main numbers**: distance, time with the engine on, liters, average consumption, cost in the region's currency (with the price entered in Settings), the same trip with gasoline and with ethanol (flex), average and maximum speed and the comparison with the car's average (from the history, with the same fuel, from 3 trips and 20 km).
- **What the trip shows**: tips in plain language, for example time stopped with the engine on, worse consumption above 110 km/h, hard accelerations, high RPM, a cold engine and an abnormal mixture.
- **Where the fuel went**: stopped with the engine on, city (up to 60 km/h) and road (above 60 km/h), with the time, distance, liters and consumption of each part.
- **Economy by speed band**: one bar for each 10 km/h band; the green one is the most economical.
- **Driving style**: hard accelerations and braking, time at high RPM and time slowing down in gear (engine braking, when the injection cuts the fuel).
- **Engine and mixture**: temperature at departure, time to warm up, how much was used with a cold engine, maximum temperature and the average mixture correction with a warm engine.
- **Charts**: speed, consumption minute by minute and engine temperature.

Buttons: **Report (PDF)** (use Print and choose "Microsoft Print to PDF"), **Spreadsheet (CSV)** (second-by-second data; in Portuguese with `;` and a decimal comma) and **Copy image** (for WhatsApp).

**Cut the trip**: in the analysis, open **Cut the trip**, choose a stretch with the **Start** and **End** controls (the stretch is highlighted on the speed chart) and click **Keep only this stretch** (analyzes only it) or **Take this stretch out** (leaves it out, for example the stop at the gas station). The cut parts turn gray on the chart; **Undo cuts** goes back to the whole trip, because the original data is still kept. The report, spreadsheet and image follow the cuts.

**Compare two trips**: in the **Analyzed trips** list, tick two trips and click **Compare the two ticked trips**. The table shows the numbers side by side (consumption, cost per km, time stopped, city and road, hard accelerations per 100 km, high RPM, engine braking, cold engine, mixture) and which was better in each. The second table compares the consumption in each speed band, which is the fairest comparison between different routes (for example, the same road with gasoline and with ethanol).

**Pre-trip check**: with the car connected, the button beside **Start trip** checks in about 10 seconds the trouble codes, the check engine light, the battery (engine off: 12.4 V or more is charged) or the alternator (engine on: 13.2 to 14.8 V) and the engine temperature. Each item appears as ✓ fine, ! attention, ✗ problem or ? not read. It only reads, it changes nothing. OBD2 does not see tires, oil, water, brakes and lights: check them by eye too.

**Analyze a recording** opens a `.json` file saved in **Recordings & reports** and analyzes it like a trip, using the car's current fuel and calibration.

Cautions: keep the laptop plugged into the car's socket and with the lid open (or set Windows not to sleep when the lid closes). What is driven with the program stopped or without a connection stays out of the calculation. If the program closes in the middle, the trip continues when it opens again. Consumption is more accurate after calibrating at the pump (**Tank full** / **Refueled**). The trips are kept on the computer, inside the program's data folder (on the portable version, in `OBD2-Scanner-dados`).

## 6f. Pre-purchase check

The **Pre-purchase check** screen helps you look at a used car before buying it. It brings together the readings that reveal a car "dressed up" for sale and ends with a traffic light: **green** (nothing wrong in what OBD sees), **yellow** (points of attention) or **red** (problems). What the car does not answer appears as **Not checked**, never as green.

1. **Car details**: a nickname, the VIN from the document and the mileage on the dashboard. All optional, but the VIN and the mileage allow two important checks.
2. **Engine off** (ignition on): the program reads the VIN stored in the control unit, the codes (confirmed, pending and permanent), the readiness self-tests, the counters since the last code clearing, the km driven with the check engine light on, the odometer (when the car reports it), the battery at rest and the VIN stored in each control unit.
3. **Start and idle**: start the engine when the program asks and leave it idling for 3 minutes. It measures the voltage drop at starting, the alternator, the fuel mixture and the automatic interpretation alerts; at the end, it reads the control unit tests (Mode 06) and the codes again.
4. **Test drive** (optional): the program records the drive and analyzes the recording like any other. Whoever drives does not touch the computer.
5. **Result**: each item explained, **Report (PDF)** and the check saved in the history. At the top of the screen, tick two or three cars to compare side by side.

| Sign | What it means |
| --- | --- |
| Few km, warm-ups or hours since the last clearing (under 300 km, 10 warm-ups or 8 h) | Codes cleared or the battery disconnected a short time ago. It may be innocent; ask the seller. |
| 2 or more incomplete self-tests | The same sign: the self-tests restart when the codes are cleared. One incomplete on its own is common. |
| Permanent code with no matching confirmed code | The codes were cleared, but the fault is still there (red). |
| Km with the check engine light on | A fault was left unrepaired for a while. |
| Control unit VIN different from the document | A control unit from another car (red). Another control unit with a different VIN is yellow. |
| Control unit odometer different from the dashboard (more than 50 km or 2 %) | Mileage tampered with or dashboard replaced (red). Only works on cars that report the odometer. |
| Battery, starting and alternator | The same limits as the guided battery test. |
| Mixture at idle (short + long trim) | Up to ±10 % normal, up to ±20 % attention, above that a problem. |

**Limits:** most cars do not report the real odometer; plain OBD basically sees the engine and sometimes the transmission (airbag, ABS and body are left out); crashes, flooding and auction history are not in the control units. Always check the number plate records, get an independent inspection and take it to a trusted mechanic.

## 6b. Performance tests

Open **Performance tests** and drive: there is no start button. The program recognizes each test by itself and keeps the result (time, distance and average acceleration):

| Test | How to do it | When it starts and ends |
| --- | --- | --- |
| 0–100 km/h | Stop the car for half a second and accelerate. | Starts the instant the car moves off (reaction time is not counted); ends on crossing 100 km/h. |
| 100–0 km/h | Pass 100 km/h and brake until stopped. | Starts on crossing 100 km/h while braking; ends when the car stops. It shows the braking distance. |
| 40–80 and 80–120 km/h | Hold a steady speed close to the starting one (up to 8 km/h below or 2 km/h above, varying at most 4 km/h) for 2 seconds and then accelerate fully. | Starts on crossing the starting speed (or at the acceleration itself, if you were already at it); ends on crossing the final one. |

Why the rolling test needs a steady speed first: in a real passing maneuver the car is "rolling" in a long gear with the engine at low RPM. If the measurement counted when the speed merely passes 40 or 80 km/h in the middle of an acceleration that started earlier, the gearbox would already be in a shorter gear, the engine at high RPM and, on turbo engines, the boost pressure already full, and the time would come out unrealistically short. That is why a single acceleration from 35 to 120 km/h only counts for the 40–80.

One test at a time: tick **Do this test** on the card of the test you will do (0–100 is chosen at the start). Only that one is active; the others are grayed out and measure nothing. Changing test discards a measurement in progress. The choice is saved per car (profile).

The test is discarded if you lift off the pedal (the speed drops), if the speed stops rising for 3 seconds or if reading fails. The times are calculated between two readings (interpolation), so the accuracy is close to 0.1 s with 8 or more readings per second. **Precise mode** reads only the speed while the screen is open, to get more readings. **Do tests only in a closed and safe place, never on public roads.** It also works with a recording played back.

## 6c. Guided tests

The **Guided tests** screen does step-by-step checks and shows the result as an indication (Good, Attention, Probable problem). The program moves on by itself as it notices what you did; the **Skip step** and **Start over** buttons are at the bottom.

**Battery and alternator** (needs the car connected, does not work with a recording):

| Step | What to do | How the program evaluates |
| --- | --- | --- |
| 1. Battery at rest | Key on, engine off. | Median of 3 s of stable voltage. 12.4 V or more: good; 12.0 to 12.4 V: low charge; under 12.0 V: discharged. Above 12.9 V it warns that it is "surface charge" from the last trip. |
| 2. Start | Start the engine. | Lowest voltage while the starter motor turns. 10.0 V or more: good; 9.6 to 10.0 V: wear; under 9.6 V: losing strength. |
| 3. Alternator | Idle; then headlights on and around 2,000 rpm. | 13.2 to 14.8 V: normal; 12.8 to 13.2 V: attention (many new cars stay there on purpose, because of smart charging); below 12.8 V: not charging; above 15.2 V: faulty regulator. |

The voltage comes from the adapter itself (the `ATRV` command, measured on pin 16, connected straight to the battery). During the test the program reads only the voltage (and the RPM in step 3), to get the most readings per second. Many simple adapters restart at starting because the voltage drops for them too: in that case step 2 has no value and the program explains why. Adapters differ by 0.1 to 0.3 V, so use the result as an indication; for a formal report, get a load test at an auto electrician. In demo mode, buttons on the screen itself turn the virtual engine off and start it.

**O2 sensors and catalyst** (also works with a recording played back):

1. Drive for about 10 minutes so the catalytic converter warms up and stop the car in an open place.
2. With the engine above 80 °C, accelerate and hold between 2,000 and 3,000 rpm for 20 seconds. At idle even a good sensor swings slowly, which is why the test is done higher.
3. The chart shows the two sensors overlaid and the result appears by itself.

| What the program sees | Indication |
| --- | --- |
| The front sensor swings between lean and rich; the rear one stays steady | Catalytic converter working |
| The rear sensor swings almost as much as the front one (copies the front one) | Catalytic converter with low efficiency (the case of code P0420) |
| Front sensor almost still (lean, rich or in the middle) | Mixture or sensor problem; then the catalytic converter cannot be assessed |
| Rear sensor low and still | Exhaust leak or faulty sensor, not necessarily the catalytic converter |

The program counts how many times each sensor crosses the middle of the scale (with a margin, so noise does not count) and compares the size of the swing of the two, instead of demanding a fixed voltage range. Cars with a wide-band sensor at the front (reads the lambda factor, close to 1.00) only have the rear sensor assessed. At the bottom, the screen shows the **catalyst monitor** and the **km since the codes were cleared**: they are the best sign that someone cleared a fault before selling the car. The control unit's own tests (Mode 06) are more reliable than the chart, because the sensor answers in milliseconds, faster than the adapter can read.

**Fuel trim map** (also works with a recording played back):

The map shows the total correction the control unit applies to the mixture (short term + long term) in 9 bands: 3 of RPM (below 1,300, 1,300 to 2,500 and above 2,500 rpm) by 3 of load (below 30%, 30 to 60% and above 60%). It fills in by itself while you drive, even outside this screen, because the live dashboard already reads these values. Each band shows the average from 10 readings: green up to ±10%, yellow from 10 to 20%, red above 20%.

Only readings in **closed loop** count (PID 03, when the control unit corrects the mixture using the sensor). With a cold engine, full throttle or deceleration the correction stands still and would spoil the averages. If the car does not report the loop, the program uses only readings with the engine above 70 °C.

| Pattern | Indication |
| --- | --- |
| Lean (positive) only at idle, normal under load | A false air leak (vacuum hose, manifold gasket, oil breather). On engines with a MAP sensor, common in flex cars, the signal is weaker. |
| Lean only under high load | A lack of fuel when the engine asks for more (weak pump, clogged filter, dirty injectors). |
| Lean everywhere | A flex car still learning the mixture after refueling, bad fuel, dirty air sensor, low pressure, an exhaust leak before the sensor. |
| Rich (negative) only at idle | Canister valve stuck open, dripping injector. |
| Rich everywhere | A leaking injector, high fuel pressure, a sensor reading wrongly, fuel in the oil. |

## 6d. Automatic interpretation

The **Data interpretation** box on the dashboard analyzes by itself the parameters being read and shows **hints**, always with what to check. It is not a diagnosis: it is a clue to take to the mechanic or to check with a guided test.

To avoid false alarms, each rule:

- only uses parameters that the car reports and that are on the dashboard right now (a value not updated for more than 5 s is ignored);
- only applies in the right conditions: mixture and sensors with a warm engine, in closed loop and outside the fuel cut on deceleration; idle with a warm engine, the car stopped and the foot off the accelerator; alternator charging only 20 s after starting;
- has to repeat for a few seconds before it appears (one odd reading on its own does not count);
- goes away only when the value comes back with some margin (for example, a lean mixture appears above +10% and goes away below +8%), so it does not flicker.

| Hint | When it appears | Parameters used |
| --- | --- | --- |
| Overheating | 115 °C or more for 5 s (critical); 108 °C or more for 10 s (attention). Up to 105 °C is normal in many cars stopped in traffic. | Engine temp. |
| Thermostat stuck open | Below 70 °C after 15 min running, or a temperature that drops below 75 °C while driving above 40 km/h after having passed 85 °C. | Engine temp., speed, run time |
| Faulty temperature sensor | Reads −40 °C (loose wire) or stays 10 °C below the outside temperature with the engine on. | Engine temp., ambient temp. |
| Faulty air temperature sensor | Reads −40 °C (loose wire) or stays 15 °C below the outside temperature with the engine on. | Air temp., ambient temp. |
| Lean or rich mixture | Total correction (10 s average of the short term + long term) above ±10% (information) or ±20% (attention), with the engine warm for at least 1 min and in closed loop. On a flex car, right after changing fuel it may be just the learning. | STFT, LTFT, loop, RPM, load |
| Battery and alternator | Engine off: below 12.0 V (weak) or 12.4 V (partial). At starting: a drop below 9.6 V. Engine on: below 12.6 V for 20 s (not charging), 12.6–13.2 V (may be smart charging), above 15.0 V for 10 s (regulator). Without the RPM on the dashboard there is no evaluation, because it cannot be known whether the engine is running. | Voltage, RPM |
| High or rough idle | Warm engine and car stopped: above 1,150 rpm for 10 s, or RPM jumping up and down (more than 250 rpm) within 15 s. A single step, like the A/C switching on, does not count. | RPM, speed, throttle |
| Weak vacuum at idle | Manifold pressure above 70% of the outside pressure for 15 s. | MAP, barometric pressure |
| Inconsistent MAP sensor | Engine off and MAP differs from the outside pressure by more than 10 kPa. | MAP, barometric pressure |
| MAF sensor with no signal | Less than 0.5 g/s with the engine above 600 rpm. | MAF, RPM |
| Hot intake air | Driving above 40 km/h for 30 s and air 30 °C above the outside (or above 65 °C with no outside temp.). Stopped, hot air is normal. | Air temp., ambient temp., speed |
| Stuck lambda sensor | Front sensor varying less than 0.3 V in 10 s, warm engine, closed loop. | Sensor B1S1 |
| Weak catalytic converter | Steady RPM, engine warm for 5 min: the rear sensor crosses the middle of the scale at least 70% as often as the front one. | Sensors B1S1 and B1S2 |
| Catalytic converter too hot | Above 900 °C for 5 s. | Catalyst temp. |

When the rule stops applying for a moment (a burst of acceleration, braking), the last result for mixture, idle and catalytic converter stays on the screen while the engine is running.

## 6e. Charts

On the **Charts** screen, each parameter gets its own chart, all with the same time axis.

- **Presets:** one click chooses a ready-made group: **From dashboard** (the same as the Live dashboard), **Mixture (fuel)**, **Temperatures**, **Electrical**, **Economy**, **Acceleration** and **Turbo**. Only what the car reports is included.
- **Choose parameters:** opens the full list, by category and with a search. You can choose any parameter the car reports, even if it is not on the Dashboard: the program starts reading it too (and it goes into the recordings). To remove a chart, click its name (with ✕).
- **Calculated by the app:** the instantaneous consumption in **L/h** and in **km/L** (or L/100 km / mpg, according to the Units) does not come from the car: it is calculated as in the trip computer and can be drawn like any other parameter.
- The more parameters are read, the slower each one updates.

With a recording open, the list shows the parameters that exist in it, plus those calculated from them.

## 7. Control unit tests (Mode 06)

Under **Trouble codes → Control unit tests**, click **Read tests**. Each line is a self-test of the control unit with the measured value and the accepted limits. A **failed** test usually points to the faulty component even before a trouble code appears. Available on cars with a CAN network (most from 2008–2010 on).

Above the table, **What the tests suggest** sums up the known patterns, always as a hint:

| Hint | When it appears |
| --- | --- |
| Misfire in one cylinder | One cylinder with a misfire count (10-cycle average ≥ 5 or last cycle ≥ 10) at least 3 times higher than the others. Points to the spark plug, coil, lead or injector of that cylinder. |
| Misfire in several cylinders | Several cylinders above those numbers. Points to something common: fuel, pressure, air intake, a single coil. |
| Catalytic converter failed / near the limit | Catalyst test failed, or passed within 10% of the upper limit (only when the limit starts at zero). |
| Lambda sensor or heater failed | Some test of that sensor or of its heater outside the limits. |

Values with no known scale (marked with *) do not enter these conclusions.

## 8. Recording, playing back and generating the report

**Record:** click **Record** on the Live dashboard (the same button becomes **Stop recording**) or **Start recording** on the **Recordings & reports** screen. If reading is stopped or paused, it starts together with the recording. If you pause reading in the middle, the recording has no data until you resume (the Recordings & reports screen warns you). The recording keeps the parameters being read (those of the Dashboard and the extra ones chosen in the Charts) and, along with them, a diagnostic reading at the start and another at the end (see *What the recording keeps*, under **Exported files**). While recording, **Mark event** (or the **Space** key) marks the moment of a jolt or noise.

**Play back:** in **Recordings & reports → Play recording**, choose a JSON file saved earlier. The dashboard, the HUD, the charts and the interpretation show the recording as if live, with pause, speed (up to 8×) and a position bar at the top. **Close recording** goes back to normal. To see the whole recording at once in the charts, use **View on charts**.

**Black box (automatic fault recording):** while reading is on, the program keeps the last 2 minutes in memory. If a new trouble code shows up (pending or confirmed) or the check-engine light turns on, it saves the **2 minutes before and the 2 minutes after** by itself, with the codes and the freeze frame the control unit stored. To notice the fault, every 5 seconds it asks the control unit whether the light turned on and, every 30 seconds, reads the pending codes (which often show up before the light). Codes the car already had when you connected do not trigger anything. Another fault within the next 2 minutes stretches the same recording (up to 10 minutes). Besides the parameters on the screen, the black box always reads about 10 essential sensors (engine speed, speed, temperature, load, throttle, fuel trims, MAP or MAF, intake air, timing and battery); reading *all* sensors would make updates far too slow on an ELM327. Automatic recordings are in **Recordings and reports → Black box**, where you can play them back, view them on the charts, generate the report, **pin** them (never deleted) or delete them. The 30 newest are kept (up to 200 MB). The **Save last 2 min** button (on the Live dashboard and on that screen) keeps the last minutes right away, when you feel something odd. If you are already recording, nothing is asked while you drive: the fault becomes a mark in your recording and the automatic recording is saved too; when you stop, a notice says what was detected. Turn it on and off in **Settings → Black box**, where you can also record when an alert goes off (at most once every 10 minutes per parameter). In demo mode, **Create new fault** (under *Simulate clone adapter failures*) makes the virtual car log code P0302 so you can try it.

**Report:** made only when you ask, from the last recording or from a saved JSON. Details under **Exported files**, just below.

## 9. Themes

In **Settings** there are 8 themes. **Night** (red on black) does not dazzle when driving at night; **High contrast** helps in strong sun or with low vision. The **☀ Day** and **☾ Night** buttons in the top corner of every screen switch to these two themes with one click; clicking the active button again goes back to the theme chosen in Settings.

## 10. Several cars (profiles)

Under **Settings → Vehicles (profiles)**, click **New vehicle** for each car and enter the name and fuel. After the first reading, the profile shows how this car's consumption is calculated (fuel flow rate, MAF sensor or MAP sensor). The engine size and the volumetric efficiency only appear on cars with MAP, because only there do they enter the calculation (until the car has been read, only the engine size appears). Each profile has its own alerts and performance results. On the first connection, the program reads the car's VIN and stores it in the active profile. After that, when connecting to any of the cars, it **switches profile by itself**. The active profile can also be changed in the box at the bottom left of the window.

## 11. Language and units

The language is under **Settings → Appearance and language** and also in the box at the bottom left of the window. There are three:

| Language | Units that come with it |
|---|---|
| **Português (Brasil)** | km/h, °C, kPa, km, liters, km/L |
| **English (US)** (American English) | mph, °F, psi, miles, US gallons, mpg (US), lb·ft |
| **English (Europe)** (British English, for those who use the European metric system) | km/h, °C, bar, km, liters, L/100 km |

When you change the language, the whole screen changes at once, without restarting, and the units and fuels become those of that language, even if you had changed a unit before. After that, just adjust what you like under **Units**. Trouble codes already read are described again in the new language. Fuel prices follow the volume unit (per liter or per gallon; the stored value is the same, only the way of showing it changes) and the currency of the fuel region.

Under **Settings → Units**, choose a preset (**Brazil**, **Europe**, **USA**, **United Kingdom**) or each unit separately: speed (km/h or mph), temperature (°C or °F), pressure (kPa, bar or psi), distance (km or miles), volume (liters or gallons), consumption (km/L, L/100 km, mpg) and torque. The change applies to the dashboard, dials, HUD, charts, alerts, trip computer, calibration at the pump, data interpretation, typical values in the glossary and the report. Recordings and exported files stay in the metric system, which is the OBD2 standard.

## 12. Automatic reconnection

With the **Reconnect automatically if the connection drops** option on (on the Connection screen and in Settings; it comes on), the program comes back by itself when Bluetooth goes out of range, the cable comes loose or the adapter freezes. A yellow bar at the top shows the attempt and the time until the next one. It tries for up to 3 minutes, with waits of 1, 2, 3, 5, 8 and then 10 seconds, and keeps the parameter list and the recording in progress. **Stop and disconnect** cancels. On a USB adapter, if Windows gives another COM number after unplugging and plugging the cable, the program finds the same adapter on the new port (by the USB serial number; on clones without a serial number, only when there is a single adapter of that type plugged in).

## 13. Adapter test and the car's control units

- **Adapter compatibility test** (**Connection** screen, with the adapter connected): finds out up to which ELM327 version the adapter really works. Clones often say "v2.1" and work like v1.3. It only uses commands that read something or that a restart undoes; nothing is written to the adapter.
- **Electronic control units** (**Vehicle & readiness** screen): lists the control units that answer through OBD (engine, transmission, hybrid system) and reads the identification of each (name, part number, supplier, software version), when the car reports it. Read-only. ABS, airbag and body use addresses specific to each manufacturer and do not appear.

## 13a. OBD standard, fuel and VIN

On the **Vehicle & readiness** screen, after **Read information**, these also appear:

- **Declared OBD standard**: what the control unit says it follows. Brazilian cars usually show **OBDBr-1** (2007 to 2010), **OBDBr-2** (from 2010/2011) or **OBDBr-3** (from 2022). Imported cars may show EOBD (Europe) or OBD-II (USA). Everything works the same.
- **Reported fuel**: what the control unit says it uses. The standard has no code for a flex car, so a flex can appear as gasoline, ethanol or bi-fuel.
- **Check digit** of the VIN: only appears on VINs from North America and China, where it exists. In Brazil the 9th position of the VIN is an ordinary character.

Details about the code database and the Brazilian particulars: [CARROS-BRASILEIROS.md](CARROS-BRASILEIROS.md).

## 13b. Screen kept on during reading

While live reading is on, a recording is in progress or the **HUD** screen is open, the program asks Windows not to turn the screen off or put the computer to sleep. When it stops, Windows goes back to normal. That way the connection does not drop in the middle of a trip.

## 13c. Documentation

The **Documentation** screen (in the menu, just below the Glossary) gathers, with no need for internet:

- **Start:** shortcuts and the **program's data** (how many parameters, trouble codes, brand tables and manufacturers it knows).
- **How to use** (this manual), **About the project**, **What's new** and the **Project rules** (what the program always does and never does).
- **Brazilian cars**, **Visual map (diagrams)** (the diagrams of every part of the program, in the theme's colors), **Sources and licenses**, **Architecture** and the **Beginner's guide to the code**.

All the documents are available in the three languages of the program: they appear in the language chosen under **Settings → Appearance and language** (English (Europe) uses British spelling). Use **Go to section…** to jump inside a document. Wide diagrams appear shrunk: click to see them at real size and again to shrink them. You can also get here through **Settings → About → Documentation, sources and licenses**.

## 14. Read-only (safety)

The program never writes anything to the car's control units. The manufacturer parameters also only read (services 21 and 22). In the **AT terminal**, commands that would write to the car or to the adapter's memory are refused with an explanation. **Clear codes** only works with the engine off and the ignition on: the program asks the car for RPM and speed before clearing and refuses if the car does not answer (key only on accessories). After clearing, it reads the codes again and warns if any came back, a sign that the fault is still there. *Permanent* codes only go away by themselves, after some usage cycles without the fault. In demo mode, use **Stop engine** under *Simulate faults* (Connection screen).

## Clone adapters

Most cheap adapters are ELM327 clones (they usually introduce themselves as "v1.5" or "v2.1", versions the original manufacturer never released). The program already handles the most common defects: it does not require `OK`, accepts the echo being on, waits for slow resets, repeats once requests that were lost or interrupted (`STOPPED`, `BUFFER FULL`) and carries on without the commands the clone refuses. The **Connection** screen shows "probable clone" and the list of refused commands.

### When the clone freezes

Clones usually freeze in three ways, and the program notices and fixes each one by itself:

| What happens | How the program notices | What it does |
| --- | --- | --- |
| Stops answering the car, but still answers AT commands. | 3 requests in a row with no answer (each already repeated once), or only `STOPPED` / `BUFFER FULL` / garbage. | Checks that the adapter is alive (`ATI`), restarts it (`ATZ`), configures it again and goes back to the same protocol as before (without the slow search). It takes a few seconds. |
| Restarts by itself on a voltage drop (common when the engine starts) and loses its settings. | The answer brings the start-up text (`ELM327 v1.5`) or `LV RESET`. | Configures again right away. |
| Freezes completely or the connection drops. | Not even `ATI` answers, or the port gives an error. While idle, a silent test every 10 s notices the drop. | Closes and reopens the connection (automatic reconnection). |

If the adapter answers but the car does not (ignition off), the program warns you and tries again every 5 seconds, without restarting the adapter over and over.

**If none of this helps:** unplug the adapter from the OBD socket for 10 seconds and plug it back in (this switches the adapter off and on, which is the only way to unfreeze some clones). If it freezes often: under **Advanced options**, turn off **fast reading** and increase the wait time per command; read fewer parameters at once; and, if possible, switch to an adapter with an original chip (or a good-quality clone, such as OBDLink, Vgate iCar Pro or Veepeak).

In **demo mode**, the Connection screen has **Simulate faulty clone adapter**: buttons that make the virtual adapter freeze, restart, hang or lose Bluetooth, so you can see the recovery working.

## Portable version (no install)

The file `OBD2-Scanner-...-Windows-portatil.zip` brings the program ready to use, with no installation:

1. Unzip the `.zip` into any folder, even a USB stick.
2. Open `OBD2-Scanner.exe`. Windows may show the same "unknown publisher" warning: **More info → Run anyway**.

As long as the `portable.txt` file is next to the program, the settings, profiles and results stay in the `OBD2-Scanner-dados` folder, right there; under **Settings → About** the path appears. Delete `portable.txt` to use the normal Windows folder. Recordings and reports are still saved wherever you choose.

Differences from the installer: it does not appear in the Start menu (create a shortcut if you like) and there is no uninstall, just delete the folder. The program needs **Microsoft Edge WebView2**, which already comes with Windows 10 and 11; the installer adds it by itself when it is missing, the portable version only warns and shows the link to download it. If the folder does not allow writing (for example, inside "Program Files"), the program uses the normal Windows folder.

## Common problems

| Symptom | What to do |
| --- | --- |
| "The adapter did not answer in time" | Wrong port or an adapter with no power. Check the COM port. Under *Advanced options*, increase the ATZ reset wait time. |
| "Adapter OK, vehicle not responding" | Turn the ignition (or the engine) on and click **Try again**. On an older car (generally before 2008, ISO 9141/KWP protocols), many cheap clones lack the "K-line" circuit: switch to a good-quality adapter. |
| "The port does not exist now" | The USB cable was unplugged or the Bluetooth pairing was removed. Click **Refresh** and choose the port again (pair again if needed). |
| "The port is being used by another program" | Close other OBD apps and other windows of this program; disconnect the adapter from the phone. |
| "Windows could not reach the Bluetooth adapter" | The adapter is out of the car, the ignition is off, it is far away or connected to a phone. Classic: if it continues, remove the pairing in Windows and pair again (PIN `1234` or `0000`). |
| Bluetooth LE does not appear in the search | Check that Windows Bluetooth is on and that the adapter is not connected to a phone. No pairing is needed; if you paired before and it does not work, remove the pairing. |
| Slow readings | Select fewer parameters on the Dashboard or reduce the wait time per command. |
| Yellow bar "Restarting the adapter" or "Trying to reconnect" | Normal with clones: the program is recovering by itself. If it lasts more than a minute, unplug the adapter for 10 seconds. See *When the clone freezes*. |
| Values jumping or freezing with a clone adapter | Under *Advanced options*, turn off **fast reading** and increase the wait time per command. |
| Calculated consumption very different from the real one | Check the fuel (and, on MAP-only cars, the engine size) under **Settings → Vehicles (profiles)**. Then use the **calibration at the pump** on the trip computer (on MAF cars, inside **Advanced**). |
| A parameter disappears from the dashboard | The car stopped answering it; the program removes it automatically. |
| Notice "needs Microsoft Edge WebView2" | Install the *WebView2 Runtime* through the link in the notice, or use the installer instead of the portable version. |
| Strange data | See the **Communication log** on the Connection screen or use the **AT terminal** (e.g. `ATI`, `ATRV`, `0100`). |

## Exported files

While recording, the program also keeps a **safety copy** on the disk, updated at least every minute, in the file `gravacao-em-andamento.jsonl` of the data folder (on the portable version, in `OBD2-Scanner-dados`). If the program or the computer shuts down in the middle of the recording, the next time it opens it comes back as the "last recording", ready to export in **Recordings & reports**. The next recording replaces this copy.

**Mark event:** while recording, press the red **Mark event** button (on the Dashboard and the HUD) or the **Space** key the moment you notice a jolt, a fault or a noise. In the **Charts** of an open recording, each mark appears as a dashed red line (★1, ★2...) and a button that zooms the charts in on that moment. During playback, **Next marker** jumps to 5 seconds before the event. In the CSV, the `mark` column is 1 on the first reading after each mark.

- **Copy image** (**Trouble codes** and **Charts** screens): builds a light card with the car, the date, the codes (and the freeze frame, if read) or the charts with minimum and maximum, and copies it to the clipboard. Paste with **Ctrl+V** into WhatsApp, Telegram or e-mail to send to a mechanic. If Windows does not accept the copy, the image is saved as a PNG.
- **CSV for Excel (Portuguese/European)**: separator `;` and decimal comma. Opens with a double click in Brazilian Excel.
- **Standard CSV**: separator `,` and decimal point.
- **JSON**: the complete recording, it can be reopened in the program (**Recordings & reports → Play recording** or **View on charts**).
- **PNG**: an image of the charts.
- **Diagnostic report**: made from a recording, only when you ask. Under **Recordings & reports → Diagnostic report**, choose **Report of the last recording** or **Report of a saved recording…** (a JSON). The report opens on screen, with the buttons *Print / save as PDF* (choose "Microsoft Print to PDF") and *Save report (HTML)*. It brings the vehicle and adapter data, the trouble codes read at the start (and those that appeared until the end), the freeze frame, readiness, Mode 06, the hints found over the whole trip (with the moment they appeared), charts of the main parameters with the marked events and a table with the minimum, average and maximum of each parameter. Recordings made in old versions also work, but without codes, readiness and Mode 06.

**What the recording keeps:** the parameters read (those of the Live dashboard and the extra ones chosen in the Charts) and, along with them, a diagnostic reading at the start (vehicle, trouble codes with freeze frame, readiness and Mode 06) and another at the end (codes and readiness). These readings only query the car, they never clear or change anything. If the car does not answer one of them, the recording continues normally and the report says what was missing.
