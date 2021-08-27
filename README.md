# homebridge-domintell
This plugin creates a connection to a Domintell Master and uses the Legacy LightProtocol to get or set information the the Master.

There is support for several kind of accessories. These can be configured in the configuration file
- Lightbulb: a typical light bulb, which can be turned on or off (0 or 1)
- DimmableLightbulb: a dimmable lightbulb which receives a value between 0 and 100
- Outlet: an outlet which can be turned on or off (0 or 1)
- WindowCovering: used for screens which go up and down
- Temperature sensor: currently reads the temperature information from the 6-button LCD screen
- ContactSensor: when an input is connected to for example a I20 module, it can be configured as a contact sensor
- MotionSensor: when an input is connected to for example a I20 module, it can be configured as a motion sensor


