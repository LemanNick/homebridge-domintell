import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeDomintell } from '../platform';
import { DomintellService } from '../domintellService';

export class LightbulbAccessory {
  private service: Service;
  private domintellService: DomintellService;

  private LightBulbStates = {
    On: false,
    Brightness: 100,
  };

  constructor(
        private readonly platform: HomebridgeDomintell,
        private readonly accessory: PlatformAccessory,
        domintellService: DomintellService,
  ) {
    this.domintellService = domintellService;
    
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'HomeBridgeDomintell')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.type)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.identifier);

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this));               // GET - bind to the `getOn` method below

    if (this.accessory.context.device.dimmable === true) {
      // register handlers for the Brightness Characteristic
      this.service.getCharacteristic(this.platform.Characteristic.Brightness)
        .onSet(this.setBrightness.bind(this))       // SET - bind to the `setBrightness` method below
        .onGet(this.getBrightness.bind(this));      // GET - bind to the `getBrightness` method below
    }

    this.domintellService.registerAccessory(this.accessory.UUID, this);
    
  }

  /**
    * Handle "SET" requests from HomeKit
    */
  async setOn(value: CharacteristicValue) {
    this.LightBulbStates.On = value as boolean;

    if (value){
      this.domintellService.setActionOn(this.accessory.UUID);
    } else {
      this.domintellService.setActionOff(this.accessory.UUID);
    }
    this.platform.log.debug(`[Light Bulb] setOn(${value})`);
  }    

  /**
     * Handle the "GET" requests from HomeKit
     */
  async getOn(): Promise<CharacteristicValue> {
    const isOn = this.LightBulbStates.On;
    this.platform.log.debug(`[Light Bulb] ${this.accessory.context.device.name} getOn()=${isOn}`);
    return isOn;
  }


  /**
     * Handle "SET" requests from HomeKit
     * These are sent when the user changes the state of an accessory, for example, changing the Brightness
     */
  async setBrightness(value: CharacteristicValue) {
    this.LightBulbStates.Brightness = value as number;
    this.domintellService.setActionDimmerValue(this.accessory.UUID, this.LightBulbStates.Brightness);
    this.platform.log.debug(`[Light Bulb] ${this.accessory.context.device.name} setBrightness(${value})`);
  }

  /**
     * Handle the "GET" requests from HomeKit
     */
  async getBrightness(): Promise<CharacteristicValue> {
    const brightness = this.LightBulbStates.Brightness;
    this.platform.log.debug(`[Light Bulb] ${this.accessory.context.device.name} getBrightness()=${brightness}`);
    return brightness;
  }


  /**
     * Handle update information from domintellService
     * These are sent by domintellService when the user changes the state of an accessory, for example, changing the Brightness
     */
  updateInformation(value: number) {

    if (this.accessory.context.device.dimmable === true) {
      this.LightBulbStates.Brightness = value;
      this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.LightBulbStates.Brightness);
    }
    this.LightBulbStates.On = value > 0;
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.LightBulbStates.On);
  }

  getAccessory(): PlatformAccessory {
    return this.accessory;
  }
}

/*

There are two bugs according to the logs below:
1) off-by-one error between sending and receiving the information from Domintell (%D33 sent, but 0x20 (=32) received...)
2) HomeBridge is done decreasing brightness to 33, and one second after that, the Domintell bus updates with 'older' information for a moment
  giving the user a weird sensation when dimming lights

[3/15/2025, 9:29:20 AM] [HomebridgeDomintell] [Websocket] [DAL] Serial=    89-26 update dataType=D to value=5C uuid=bc2b8102-8fad-4683-aa97-ca26af1df629
[3/15/2025, 9:29:31 AM] [HomebridgeDomintell] [Light Bulb] getOn()=true
[3/15/2025, 9:29:31 AM] [HomebridgeDomintell] [Light Bulb] getBrightness()=92
[3/15/2025, 9:29:31 AM] [HomebridgeDomintell] [WebSocket] > DAL    89-26%D89
[3/15/2025, 9:29:31 AM] [HomebridgeDomintell] [Light Bulb] setBrightness(89)
[3/15/2025, 9:29:31 AM] [HomebridgeDomintell] [WebSocket] > DAL    89-26%D33
[3/15/2025, 9:29:31 AM] [HomebridgeDomintell] [Light Bulb] setBrightness(33)
[3/15/2025, 9:29:32 AM] [HomebridgeDomintell] [Websocket] [DAL] Serial=    89-26 update dataType=D to value=58 uuid=bc2b8102-8fad-4683-aa97-ca26af1df629
[3/15/2025, 9:29:32 AM] [HomebridgeDomintell] [Websocket] [DAL] Serial=    89-26 update dataType=D to value=20 uuid=bc2b8102-8fad-4683-aa97-ca26af1df629


[3/15/2025, 9:56:03 AM] [HomebridgeDomintell] [Light Bulb] setBrightness(1) = 1
[3/15/2025, 9:56:04 AM] [HomebridgeDomintell] [Websocket] [DAL] Serial=    89-26 update dataType=D to value=01 uuid=bc2b8102-8fad-4683-aa97-ca26af1df629

[3/15/2025, 9:56:24 AM] [HomebridgeDomintell] [Light Bulb] setBrightness(2) = 1
[3/15/2025, 9:56:24 AM] [HomebridgeDomintell] [Websocket] [DAL] Serial=    89-26 update dataType=D to value=01 uuid=bc2b8102-8fad-4683-aa97-ca26af1df629

[3/15/2025, 10:21:37 AM] [HomebridgeDomintell] [Light Bulb] setBrightness(20) = 19
[3/15/2025, 10:21:38 AM] [HomebridgeDomintell] [Websocket] [DAL] Serial=    89-26 update dataType=D to value=13 uuid=bc2b8102-8fad-4683-aa97-ca26af1df629

[3/15/2025, 10:21:18 AM] [HomebridgeDomintell] [Light Bulb] setBrightness(30) = 29
[3/15/2025, 10:21:18 AM] [HomebridgeDomintell] [Websocket] [DAL] Serial=    89-26 update dataType=D to value=1D uuid=bc2b8102-8fad-4683-aa97-ca26af1df629

[3/15/2025, 10:20:56 AM] [HomebridgeDomintell] [Light Bulb] setBrightness(80) = 79
[3/15/2025, 10:20:57 AM] [HomebridgeDomintell] [Websocket] [DAL] Serial=    89-26 update dataType=D to value=4F uuid=bc2b8102-8fad-4683-aa97-ca26af1df629

[3/15/2025, 10:22:02 AM] [HomebridgeDomintell] [Light Bulb] setBrightness(90) = 89
[3/15/2025, 10:22:03 AM] [HomebridgeDomintell] [Websocket] [DAL] Serial=    89-26 update dataType=D to value=59 uuid=bc2b8102-8fad-4683-aa97-ca26af1df629

[3/15/2025, 10:25:12 AM] [HomebridgeDomintell] [Light Bulb] setBrightness(98) = 97
[3/15/2025, 10:25:13 AM] [HomebridgeDomintell] [Websocket] [DAL] Serial=    89-26 update dataType=D to value=61 uuid=bc2b8102-8fad-4683-aa97-ca26af1df629

[3/15/2025, 9:56:51 AM] [HomebridgeDomintell] [Light Bulb] setBrightness(99) = 100
[3/15/2025, 9:56:51 AM] [HomebridgeDomintell] [Websocket] [DAL] Serial=    89-26 update dataType=D to value=64 uuid=bc2b8102-8fad-4683-aa97-ca26af1df629

[3/15/2025, 9:57:03 AM] [HomebridgeDomintell] [Light Bulb] setBrightness(100) = 100
[3/15/2025, 9:57:04 AM] [HomebridgeDomintell] [Websocket] [DAL] Serial=    89-26 update dataType=D to value=64 uuid=bc2b8102-8fad-4683-aa97-ca26af1df629


[3/15/2025, 9:50:26 AM] [HomebridgeDomintell] [WebSocket] > DAL    89-26%I
[3/15/2025, 9:50:26 AM] [HomebridgeDomintell] [Light Bulb] setOn(true)
[3/15/2025, 9:50:26 AM] [HomebridgeDomintell] [WebSocket] > DAL    89-26%D1
[3/15/2025, 9:50:26 AM] [HomebridgeDomintell] [Light Bulb] setBrightness(1)
[3/15/2025, 9:50:26 AM] [HomebridgeDomintell] [Websocket] [DAL] Serial=    89-26 update dataType=D to value=01 uuid=bc2b8102-8fad-4683-aa97-ca26af1df629
[3/15/2025, 9:50:51 AM] [HomebridgeDomintell] [Light Bulb] getOn()=true
[3/15/2025, 9:50:51 AM] [HomebridgeDomintell] [Light Bulb] getBrightness()=1
[3/15/2025, 9:50:51 AM] [HomebridgeDomintell] [WebSocket] > DAL    89-26%O
[3/15/2025, 9:50:51 AM] [HomebridgeDomintell] [Light Bulb] setOn(false)
[3/15/2025, 9:50:51 AM] [HomebridgeDomintell] [WebSocket] > DAL    89-26%D0
[3/15/2025, 9:50:51 AM] [HomebridgeDomintell] [Light Bulb] setBrightness(0)
[3/15/2025, 9:50:52 AM] [HomebridgeDomintell] [Websocket] [DAL] Serial=    89-26 update dataType=D to value=00 uuid=bc2b8102-8fad-4683-aa97-ca26af1df629
[3/15/2025, 9:50:52 AM] [HomebridgeDomintell] [Websocket] [PRL] Serial=   13E update dataType=O to value=00 uuid=9f0fc836-6b98-4f39-a717-bb3d91ad084a
[3/15/2025, 9:50:52 AM] [HomebridgeDomintell] No Accessory found, not processing update further... undefined
*/