# homebridge-domintell
This plugin creates a connection to a Domintell Master and uses the Legacy LightProtocol to get or set information to the Master. The code has been tested against DGQG04 Master.

## Supported modules
This code has been tested against several modules, including:
- DGQG04: Master
- DBIR01: 8 bipolar relays
- DDIM01: 8 dimmer commands
- DINTDALI01: DALI interface
- DISM20: 20 input module (04 and 08 variant should also work; but not tested)
- DPBRLCD02: Rainbow LCD push buttons (only temperature readout)
- DTRV01: 4 shutter inverters
- DMOV05: Infrared detector (DMOV01 and DMOV02 should also work; but not tested)

## General configuration
You will need to define the IP address of the Domintell master as well as the port (default: 17481). The parameters are "ip" to set an IPv4 address, and "port" to set the port number. If port number is not specified, the default port will be used. The configuration file can be edited through the Homebridge UI.

Please note that password protected logins are not (yet) supported.

## Adding accessories 
Accessories can also be added through the configuration file. The reason for choosing a configuration file is because it is more flexible than automatically reading the APPINFO from Domintell. Now you can define what kind of accessorie is connected to a digital output.

All accessories should be added to the 'accessories' list. Each accessory consists of:
- _Identifier_: This is the unique identifier for your accessory. You can obtain this information with the APPINFO output. The length is typical 9 to 12 bytes. Some examples are (note that the spaces between module name and serial number need to match whatever APPINFO returns):
  - `DAL    89-03` : Addresses the third DALI interface with serial 89
  - `DIM  2185-1` : The first dimmer output of the module with serial 2185
  - `PRL   130` : Rainbow LCD Push Button with serial 130 (currently only the reading of the temperature is supported)
  - `I20   23A-4` : The fourth input of the input module with serial 23A

- _Name_: the name you wish to give to your accessorie. This does not need to match with the Domintell name
- _Type_: you can choose what type of object this accessory is. 
  - `Lightbulb`: a typical light bulb, which can be turned on or off (0 or 1)
  - `DimmableLightbulb`: a dimmable lightbulb which receives a value between 0 and 100
  - `Outlet`: an outlet which can be turned on or off (0 or 1)
  - `WindowCovering`: used for screens which go up and down
  - `TemperatureSensor`: currently reads the temperature information from the 6-button LCD screen
  - `ContactSensor`: when an input is connected to for example a I20 module, it can be configured as a contact sensor
  - `MotionSensor`: when an input is connected to for example a I20 module, it can be configured as a motion sensor
- _movementDuration_: in the case of `WindowCovering` this value indicates how long it takes for the screen to move from the full down position to the full up position (typically longer than the downwards movement). This value is in milliseconds.

## Example config file
```JSON
{
    "name": "HomebridgeDomintell",
    "platform": "HomebridgeDomintell",
    "ip": "192.168.0.1",
    "port": 17481,
    "accessories": [
        {
            "identifier": "DAL    89-01",
            "name": "Living room lights",
            "type": "DimmableLightbulb"
        },
        {
            "identifier": "DAL    89-02",
            "name": "Kitchen Lights",
            "type": "DimmableLightbulb"
        },
        {
            "identifier": "BIR  60A2-2",
            "name": "Toilet Light",
            "type": "Lightbulb"
        },
        {
            "identifier": "PRL   130",
            "name": "Temperature Kitchen",
            "type": "TemperatureSensor"
        },
        {
            "identifier": "DET  1804-1",
            "name": "Garage Motion Detector",
            "type": "MotionSensor"
        },
        {
            "identifier": "I20   23A-2",
            "name": "Garage Side Door",
            "type": "ContactSensor"
        },
        {
            "identifier": "I20   23A-F",
            "name": "Garden Motion Detector",
            "type": "MotionSensor"
        },
        {
            "identifier": "TRV  2535-3",
            "name": "Living room window covering",
            "type": "WindowCovering",
            "movementDuration": 16000
        }
    ]
}
```

