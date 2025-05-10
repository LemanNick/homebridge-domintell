import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeDomintell } from '../platform';
import { DomintellService } from '../domintellService';

export class TemperatureAccessory {
  private service: Service;
  private domintellService: DomintellService;

  private TemperatureStates = {
    CurrentTemperature: 0.0,
  };

  constructor(
        private readonly platform: HomebridgeDomintell,
        private readonly accessory: PlatformAccessory,
        domintellService: DomintellService,
  ) {
    this.domintellService = domintellService;
    
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.type)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.identifier);

    // get the TemperatureSensor service if it exists, otherwise create a new TemperatureSensor service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.TemperatureSensor) || this.accessory.addService(this.platform.Service.TemperatureSensor);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));               // GET - bind to the `getOn` method below

    this.domintellService.registerAccessory(this.accessory.UUID, this);
    
  }

  /**
     * Handle the "GET" requests from HomeKit
     * These are sent when HomeKit wants to know the current state of the accessory, for example, checking a Temperature 
     *
     * GET requests should return as fast as possbile. A long delay here will result in
     * HomeKit being unresponsive and a bad user experience in general.
     * 
     * If your device takes time to respond you should update the status of your device
     * asynchronously instead using the `updateCharacteristic` method instead.
     * 
     * @example
     * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
     * */
  async getCurrentTemperature(): Promise<CharacteristicValue> {
    const currentTemperature = this.TemperatureStates.CurrentTemperature;
        
    this.platform.log.debug('Get Characteristic CurrentTemperature ->', currentTemperature);
        
    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    return currentTemperature;
  }

  /**
     * Handle update information from domintellService
     * These are sent by Domintell when the user changes the state of an accessory, for example, changing the Brightness
     */
  updateInformation(value: number) {
    this.TemperatureStates.CurrentTemperature = value;
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.TemperatureStates.CurrentTemperature);
  }

  getAccessory(): PlatformAccessory {
    return this.accessory;
  }

}