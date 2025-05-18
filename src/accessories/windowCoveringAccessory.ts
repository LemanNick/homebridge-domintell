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
    currentTiltAngle: 0,
    targetTiltAngle: 0,
    tiltType: 0, // 0=fixed, 1=horizontal, 2=vertical
    movementDuration: 0, // seconds for 0-100%
    tiltDuration: 0, // seconds for -90 to +90 degrees
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
    this.WindowCoveringStates.movementDuration = accessory.context.device.movementDuration; // seconds for 0-100%
    this.WindowCoveringStates.tiltDuration = accessory.context.device.tiltDuration; // seconds for -90 to +90 degrees
    this.WindowCoveringStates.tiltType = accessory.context.device.tiltType; // 0=fixed, 1=horizontal, 2=vertical

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

    if (this.WindowCoveringStates.tiltType === 1) {
      this.service.getCharacteristic(this.platform.Characteristic.CurrentHorizontalTiltAngle)
        .onGet(this.getCurrentTiltAngle.bind(this));
      this.service.getCharacteristic(this.platform.Characteristic.TargetHorizontalTiltAngle)
        .onSet(this.setTargetTiltAngle.bind(this))
        .onGet(this.getTargetTiltAngle.bind(this));
    } else {
      this.service.getCharacteristic(this.platform.Characteristic.CurrentVerticalTiltAngle)
        .onGet(this.getCurrentTiltAngle.bind(this));
      this.service.getCharacteristic(this.platform.Characteristic.TargetVerticalTiltAngle)
        .onSet(this.setTargetTiltAngle.bind(this))
        .onGet(this.getTargetTiltAngle.bind(this));
    }

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
  
  async setTargetTiltAngle(value: CharacteristicValue) {
    this.WindowCoveringStates.targetTiltAngle = value as number;

    // Start tilt movement loop (timed)
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

  async getTargetPosition(): Promise<CharacteristicValue> {
    const targetPosition = this.WindowCoveringStates.targetPosition;
    return targetPosition;
  }

  async getPositionState(): Promise<CharacteristicValue> {
    const positionState = this.WindowCoveringStates.positionState;
    return positionState;
  }

  async getCurrentTiltAngle(): Promise<CharacteristicValue> {
    const currentTiltAngle = this.WindowCoveringStates.currentTiltAngle;
    return currentTiltAngle;
  }
  
  async getTargetTiltAngle(): Promise<CharacteristicValue> {
    const targetTiltAngle = this.WindowCoveringStates.targetTiltAngle;
    return targetTiltAngle;
  }

  private async monitorMovementLoop() {
    
    let lastUpdate = Date.now();
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 100)); // Check every 100ms for better accuracy
      const now = Date.now();
      const elapsed = (now - lastUpdate); // milliseconds
      lastUpdate = now;

      const movementSpeed = 100 / (this.WindowCoveringStates.movementDuration*1000);
      const tiltSpeed = 180 / (this.WindowCoveringStates.tiltDuration*1000);

      const prevSate = { ...this.WindowCoveringStates };

      // Determine direction
      const positionDiff = this.WindowCoveringStates.targetPosition - this.WindowCoveringStates.currentPosition;
      const direction = positionDiff === 0 ? 0 : (positionDiff > 0 ? 1 : -1);

      if (this.WindowCoveringStates.currentPosition === this.WindowCoveringStates.targetPosition) {
        this.WindowCoveringStates.positionState = this.platform.Characteristic.PositionState.STOPPED;
      } else if (this.WindowCoveringStates.currentPosition > this.WindowCoveringStates.targetPosition) {
        this.WindowCoveringStates.positionState = this.platform.Characteristic.PositionState.DECREASING;
        if (this.WindowCoveringStates.tiltType > 0) {
          this.WindowCoveringStates.targetTiltAngle = 90; // Reset tilt angle when moving
        }
      } else if (this.WindowCoveringStates.currentPosition < this.WindowCoveringStates.targetPosition) {
        this.WindowCoveringStates.positionState = this.platform.Characteristic.PositionState.INCREASING;
        if (this.WindowCoveringStates.tiltType > 0) {
          this.WindowCoveringStates.targetTiltAngle = -90; // Reset tilt angle when moving
        }
      }


      // Link tilt to movement
      if (this.WindowCoveringStates.currentTiltAngle !== this.WindowCoveringStates.targetTiltAngle) {
        // Upwards (open): tilt to +90 first, then move
        // Downwards (close): tilt to -90 first, then move
        const tiltDirection = this.WindowCoveringStates.currentTiltAngle < this.WindowCoveringStates.targetTiltAngle ? 1 : -1;
        const tiltDistance = Math.abs(this.WindowCoveringStates.targetTiltAngle - this.WindowCoveringStates.currentTiltAngle);
        const tiltStep = Math.min(tiltDistance, tiltSpeed * elapsed) * tiltDirection;

        this.WindowCoveringStates.currentTiltAngle += tiltStep;

        // Clamp
        if ((tiltDirection > 0 && this.WindowCoveringStates.currentTiltAngle > this.WindowCoveringStates.targetTiltAngle) ||
            (tiltDirection < 0 && this.WindowCoveringStates.currentTiltAngle < this.WindowCoveringStates.targetTiltAngle)) {
          this.WindowCoveringStates.currentTiltAngle = this.WindowCoveringStates.targetTiltAngle;
        }
      }

      // Position movement (only after tilt phase is done)
      if ((this.WindowCoveringStates.currentPosition !== this.WindowCoveringStates.targetPosition) && 
          (this.WindowCoveringStates.currentTiltAngle === this.WindowCoveringStates.targetTiltAngle)) {
        const distance = Math.abs(this.WindowCoveringStates.targetPosition - this.WindowCoveringStates.currentPosition);
        const step = Math.min(distance, movementSpeed * elapsed) * direction;

        this.WindowCoveringStates.currentPosition += step;
        // Clamp
        if ((direction > 0 && this.WindowCoveringStates.currentPosition > this.WindowCoveringStates.targetPosition) ||
            (direction < 0 && this.WindowCoveringStates.currentPosition < this.WindowCoveringStates.targetPosition)) {
          this.WindowCoveringStates.currentPosition = this.WindowCoveringStates.targetPosition;
        }
        if (this.WindowCoveringStates.currentPosition === this.WindowCoveringStates.targetPosition) {
          this.WindowCoveringStates.positionState = this.platform.Characteristic.PositionState.STOPPED;
        }
      }

      // Update HomeKit with the new state
      if (prevSate.currentPosition !== this.WindowCoveringStates.currentPosition ||
          prevSate.currentTiltAngle !== this.WindowCoveringStates.currentTiltAngle ||
          prevSate.positionState !== this.WindowCoveringStates.positionState) {
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, Math.round(this.WindowCoveringStates.currentPosition));
        this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.WindowCoveringStates.positionState);

        if (this.WindowCoveringStates.tiltType === 1) {
          this.service.updateCharacteristic(this.platform.Characteristic.CurrentHorizontalTiltAngle, Math.round(this.WindowCoveringStates.currentTiltAngle));
          this.service.updateCharacteristic(this.platform.Characteristic.TargetHorizontalTiltAngle, Math.round(this.WindowCoveringStates.targetTiltAngle)); 
        } else {
          this.service.updateCharacteristic(this.platform.Characteristic.CurrentVerticalTiltAngle, Math.round(this.WindowCoveringStates.currentTiltAngle));
          this.service.updateCharacteristic(this.platform.Characteristic.TargetVerticalTiltAngle, Math.round(this.WindowCoveringStates.targetTiltAngle)); 
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