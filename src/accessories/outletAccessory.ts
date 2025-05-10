import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeDomintell } from '../platform';
import { DomintellService } from '../domintellService';

export class OutletAccessory {
  private service: Service;
  private domintellService: DomintellService;

  private OutletStates = {
    On: false,
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

    // get the Outlet service if it exists, otherwise create a new Outlet service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Outlet) || this.accessory.addService(this.platform.Service.Outlet);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this));               // GET - bind to the `getOn` method below

    this.domintellService.registerAccessory(this.accessory.UUID, this);
    
  }

  /**
    * Handle "SET" requests from HomeKit
    */
  async setOn(value: CharacteristicValue) {
    this.OutletStates.On = value as boolean;

    if (value){
      this.domintellService.setActionOn(this.accessory.UUID);
    } else {
      this.domintellService.setActionOff(this.accessory.UUID);
    }
  }    

  /**
     * Handle the "GET" requests from HomeKit
     */
  async getOn(): Promise<CharacteristicValue> {
    const isOn = this.OutletStates.On;
    return isOn;
  }

  /**
     * Handle update information from domintellService
     */
  updateInformation(value: number) {
    this.OutletStates.On = value > 0;
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.OutletStates.On);
  }

  getAccessory(): PlatformAccessory {
    return this.accessory;
  }

}