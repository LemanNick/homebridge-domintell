import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  Service,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { DomintellService } from './domintellService.js';
import { LightbulbAccessory } from './accessories/lightbulbAccessory.js';
import { OutletAccessory } from './accessories/outletAccessory.js';
import { TemperatureAccessory } from './accessories/temperatureAccessory.js';
import { MotionSensorAccessory } from './accessories/motionSensorAccessory.js';
import { SwitchAccessory } from './accessories/switchAccessory.js';
import { WindowCoveringAccessory } from './accessories/windowCoveringAccessory.js';

export class HomebridgeDomintell implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];
  
  private domintellService!: DomintellService;
 
  constructor(
    public readonly log: Logging, 
    public readonly config: PlatformConfig, 
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    const { ip, port, username, password } = this.config;

    if ( !ip || !port ) {
      this.log.error('Domintell IP and Port are missing in config!');
      return;
    }
    this.domintellService = DomintellService.getInstance(ip, port, username, password, api, log);

    this.log.debug('Finished initializing platform');

    /*
     * When this event is fired, homebridge restored all cached accessories from disk and did call their respective
     * `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
     * after this event was fired, in order to ensure they weren't added to homebridge already.
     * This event can also be used to start discovery of new accessories.
     */
    this.api.on('didFinishLaunching', () => {
      log.debug('Excecuted didFinishLaunching callback');
      this.discoverDevices();
    });

  }

  /*
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
  */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  discoverDevices() {
    // Read devices from config file
    /*
    if (!Array.isArray(this.config.accessories) || this.config.accessories.length === 0) {
      return;
    }
    */
    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of this.config.accessories?? []) {
      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.identifier);
      this.log.warn(`Discover device='${device.identifier}' with uuid='${uuid}'`);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.get(uuid);

      if (existingAccessory) {
        // the accessory already exists

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. e.g.:
        //existingAccessory.context.device = device;
        this.log.info('disabled = ',device.disabled);
        if (device.disabled) {
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
          this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
        } else {
          existingAccessory.updateDisplayName(device.name);
          existingAccessory.context.device = device;
          this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

          switch (device.type) {
          case 'Lightbulb':
            new LightbulbAccessory(this, existingAccessory, this.domintellService);
            break;
          case 'Outlet':
            new OutletAccessory(this, existingAccessory, this.domintellService);
            break;
          case 'TemperatureSensor':
            new TemperatureAccessory(this, existingAccessory, this.domintellService);
            break;
          case 'MotionSensor':
            new MotionSensorAccessory(this, existingAccessory, this.domintellService);
            break;
          case 'Switch':
            new SwitchAccessory(this, existingAccessory, this.domintellService);
            break;
          case 'WindowCovering':
            new WindowCoveringAccessory(this, existingAccessory, this.domintellService);
            break;
          default:
            this.log.warn(`Unknown accessory type: ${device.type}`);
          }
    
          
          this.api.updatePlatformAccessories([existingAccessory]);
        }

      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', device.name);

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.name, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        switch (device.type) {
        case 'Lightbulb':
          new LightbulbAccessory(this, accessory, this.domintellService);
          break;
        case 'Outlet':
          new OutletAccessory(this, accessory, this.domintellService);
          break;
        case 'TemperatureSensor':
          new TemperatureAccessory(this, accessory, this.domintellService);
          break;
        case 'MotionSensor':
          new MotionSensorAccessory(this, accessory, this.domintellService);
          break;
        case 'Switch':
          new SwitchAccessory(this, accessory, this.domintellService);
          break;
        case 'WindowCovering':
          new WindowCoveringAccessory(this, accessory, this.domintellService);
          break;
        default:
          this.log.warn(`Unknown accessory type: ${device.type}`);
        }

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // push into discoveredCacheUUIDs
      this.discoveredCacheUUIDs.push(uuid);
    }

    // deal with accessories from the cache which are no longer present by removing them from Homebridge
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

}
