import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeDomintell } from '../platform';
import { DomintellService } from '../domintellService';

export class WindowCoveringAccessory {
  private service: Service;
  private domintellService: DomintellService;

  private WindowCoveringStates = {
    currentPosition: 100,
    targetPosition: 100,
    positionState: 2, // Stopped
    slats: 0, // 0=None, 1=Horizontal, 2=Vertical
    holdPosition: false,

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

    // get the WindowCovering service if it exists, otherwise create a new WindowCovering service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.WindowCovering) || this.accessory.addService(this.platform.Service.WindowCovering);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.PositionState)
      .onGet(this.getPositionState.bind(this));               

    this.service.getCharacteristic(this.platform.Characteristic.CurrentPosition)
      .onGet(this.getCurrentPosition.bind(this));               

    this.service.getCharacteristic(this.platform.Characteristic.TargetPosition)
      .onSet(this.setTargetPosition.bind(this))                
      .onGet(this.getTargetPosition.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.HoldPosition)
      .onSet(this.setHoldPosition.bind(this));        

    this.domintellService.registerAccessory(this.accessory.UUID, this);
    
    this.setHoldPosition(this.WindowCoveringStates.holdPosition);
    this.monitorMovementLoop();

  }

  /**
    * Handle "SET" requests from HomeKit
    */
  async setTargetPosition(value: CharacteristicValue) {
    this.WindowCoveringStates.targetPosition = value as number;

    if (value){
      this.domintellService.setActionOn(this.accessory.UUID);
    } else {
      this.domintellService.setActionOff(this.accessory.UUID);
    }
  }  
  
  async getTargetPosition(): Promise<CharacteristicValue> {
    const targetPosition = this.WindowCoveringStates.targetPosition;
    return targetPosition;
  }

  async getPositionState(): Promise<CharacteristicValue> {
    const positionState = this.WindowCoveringStates.positionState;
    return positionState;
  }

  async setHoldPosition(value: CharacteristicValue) {
    this.WindowCoveringStates.holdPosition = value as boolean;

    if (this.WindowCoveringStates.holdPosition){
      this.setTargetPosition(this.WindowCoveringStates.currentPosition);
      // Stop motors
      this.WindowCoveringStates.positionState = this.platform.Characteristic.PositionState.STOPPED;
      this.WindowCoveringStates.holdPosition = false;
    }
  }  

  /**
     * Handle the "GET" requests from HomeKit
     */
  async getCurrentPosition(): Promise<CharacteristicValue> {
    const currentPosition = this.WindowCoveringStates.currentPosition;
    return currentPosition;
  }

  private async monitorMovementLoop() {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
  
      if (this.WindowCoveringStates.currentPosition !== this.WindowCoveringStates.targetPosition) {
        const step = this.WindowCoveringStates.currentPosition < this.WindowCoveringStates.targetPosition ? 1 : -1;
        this.WindowCoveringStates.currentPosition += step;
  
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, this.WindowCoveringStates.currentPosition);
  
        if (this.WindowCoveringStates.currentPosition === this.WindowCoveringStates.targetPosition) {
          this.WindowCoveringStates.positionState = this.platform.Characteristic.PositionState.STOPPED;
          this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.WindowCoveringStates.positionState);
        }
      }
    }
  }

  /**
     * Handle update information from domintellService
     */
  updateInformation(value: number) {
    this.WindowCoveringStates.currentPosition = value;
    //this.service.updateCharacteristic(this.platform.Characteristic.On, this.WindowCoveringStates.On);
  }

  getAccessory(): PlatformAccessory {
    return this.accessory;
  }

}