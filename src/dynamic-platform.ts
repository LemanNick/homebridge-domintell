import http, {IncomingMessage, Server, ServerResponse} from "http";
import {
  API,
  APIEvent,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  DynamicPlatformPlugin,
  HAP,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  PlatformConfig,
} from "homebridge";
import WebSocket from 'ws';

const PLUGIN_NAME = "homebridge-plugin-domintell";
const PLATFORM_NAME = "HomebridgeDomintell";

/*
 * IMPORTANT NOTICE
 *
 * One thing you need to take care of is, that you never ever ever import anything directly from the "homebridge" module (or the "hap-nodejs" module).
 * The above import block may seem like, that we do exactly that, but actually those imports are only used for types and interfaces
 * and will disappear once the code is compiled to Javascript.
 * In fact you can check that by running `npm run build` and opening the compiled Javascript file in the `dist` folder.
 * You will notice that the file does not contain a `... = require("homebridge");` statement anywhere in the code.
 *
 * The contents of the above import statement MUST ONLY be used for type annotation or accessing things like CONST ENUMS,
 * which is a special case as they get replaced by the actual value and do not remain as a reference in the compiled code.
 * Meaning normal enums are bad, const enums can be used.
 *
 * You MUST NOT import anything else which remains as a reference in the code, as this will result in
 * a `... = require("homebridge");` to be compiled into the final Javascript code.
 * This typically leads to unexpected behavior at runtime, as in many cases it won't be able to find the module
 * or will import another instance of homebridge causing collisions.
 *
 * To mitigate this the {@link API | Homebridge API} exposes the whole suite of HAP-NodeJS inside the `hap` property
 * of the api object, which can be acquired for example in the initializer function. This reference can be stored
 * like this for example and used to access all exported variables and classes from HAP-NodeJS.
 */
let hap: HAP;
let Accessory: typeof PlatformAccessory;
let ws: WebSocket;
let connectionTimeout = 0;
let platform: HomebridgeDomintell;
let ip: string;
let port: number = 17481;

enum AccessoryType {
  Lightbulb = 1,
  DimmableLightbulb = 2,
  Outlet = 3,
  WindowCovering = 4,
  TemperatureSensor = 5,
  ContactSensor = 6,
  MotionSensor = 7
}

export = (api: API) => {
  hap = api.hap;
  Accessory = api.platformAccessory;

  api.registerPlatform(PLATFORM_NAME, HomebridgeDomintell);
};

class HomebridgeDomintell implements DynamicPlatformPlugin {

  private readonly log: Logging;
  private readonly api: API;

  private requestServer?: Server;

  private readonly accessories: PlatformAccessory[] = [];

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.api = api;
    platform = this;

    if (config.ip) {
      ip = config.ip;
    }
    else {
      log.error("No IP address specified in config..."); 
      // probly stop loading plugin any further as we do not know where to connect to
    }
    port = config.port || 17481;

    /*
     * When this event is fired, homebridge restored all cached accessories from disk and did call their respective
     * `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
     * after this event was fired, in order to ensure they weren't added to homebridge already.
     * This event can also be used to start discovery of new accessories.
     */
    api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
 //     log.info("Example platform 'didFinishLaunching'");

      this.setupWebSocket();

      // Parse config file, and add accessories
      if (config.accessories.length > 0) {
        for (var confacc of config.accessories) {
          platform.addAccessory(confacc);
        }
      }
      
      // The idea of this plugin is that we open a http service which exposes api calls to add or remove accessories
      this.createHttpService();
    });

    /* Set keepalive status. Send a PING command every 15 seconds, before server closes the connection */
    const interval = setInterval(function ping() {
      ws.send('PING');
      connectionTimeout+=1;

      if (connectionTimeout >= 3) {
        log.info("Connection timeout currently %i", connectionTimeout)
        // TODO: if connectionTimeout equals 3, reesatablish connection
      }
    }, 15000);
  }

  /*
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    //this.log("Configuring accessory '%s' of type %i", accessory.displayName, accessory.context.type);

    accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log("%s identified!", accessory.displayName);
    });

    if (accessory.context.type == AccessoryType.DimmableLightbulb) {
      accessory.getService(hap.Service.Lightbulb)!.getCharacteristic(hap.Characteristic.Brightness)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          accessory.context.brightness = value;
          callback();
        });
        accessory.getService(hap.Service.Lightbulb)!.getCharacteristic(hap.Characteristic.On)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          if (value) {
            if (accessory.context.brightness == undefined){
              accessory.context.brightness = 100
            }
            
            let commandstring = accessory.context.myData + '%D'+accessory.context.brightness;
            //this.log.info("%s has received power on request (%s)",accessory.displayName, commandstring);   
            ws.send(commandstring);
          } else {
            let commandstring = accessory.context.myData + '%D0';
            //this.log.info("%s has received power off request (%s)",accessory.displayName, commandstring);
            ws.send(commandstring);
          }
          callback();
        });
    } else if (accessory.context.type == AccessoryType.Lightbulb ) {
      accessory.getService(hap.Service.Lightbulb)!.getCharacteristic(hap.Characteristic.On)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        if (value) {
          let commandstring = accessory.context.myData + '%I';
          //this.log.info("%s has received power on request (%s)",accessory.displayName, commandstring);   
          ws.send(commandstring);
        } else {
          let commandstring = accessory.context.myData + '%O';
          //this.log.info("%s has received power off request (%s)",accessory.displayName, commandstring);
          ws.send(commandstring);
        }
        callback();
      });
    } else if (accessory.context.type == AccessoryType.Outlet ) {
      accessory.getService(hap.Service.Outlet)!.getCharacteristic(hap.Characteristic.On)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        if (value) {
          let commandstring = accessory.context.myData + '%I';
          //this.log.info("%s has received power on request (%s)",accessory.displayName, commandstring);   
          ws.send(commandstring);
        } else {
          let commandstring = accessory.context.myData + '%O';
          //this.log.info("%s has received power off request (%s)",accessory.displayName, commandstring);
          ws.send(commandstring);
        }
        callback();
      });
    } else if (accessory.context.type == AccessoryType.TemperatureSensor ) {
      //set Celcius as temperature unit
      accessory.getService(hap.Service.TemperatureSensor)!.updateCharacteristic(hap.Characteristic.TemperatureDisplayUnits, 0);
   }
      
    this.accessories.push(accessory);
  }

  setupWebSocket(){
    platform.log.info("Opening a new connection to Domintell '%s' on port %i",ip,port)

    connectionTimeout = 0;
    ws = new WebSocket("wss://"+ip+":"+port, {rejectUnauthorized:false});
    
    ws.on('message', function incoming(message: String){
      // We received a message from Domintell, parse it here
      if (message.startsWith("INFO:Waiting for LOGINPSW:")) {
        // Send PWD info or login
        platform.log.info("Sending login info to Domintell")
        // TODO: no support yet for password protected configurations
        ws.send('LOGINPSW@:');
      } else if (message.startsWith("APPINFO")) {
        platform.log.info("APPINFO says: '%s'",message);
      } else if (message.startsWith("PONG")) {
        // Reset connection timeout
        connectionTimeout = 0;
      } else {
        // Split multi-line messages and iterate through each line
        const splitmsg = message.split(/\r\n|\r|\n/);
        for (var i = 0; i < splitmsg.length; i++) {

          if (splitmsg[i].startsWith("DAL")){
            // Parse DINTDALI01 messages
            const uid = splitmsg[i].substr(0,12).toString();
            const value = parseInt( splitmsg[i].substr(13),16);

            platform.updateAccessory(hap.uuid.generate(uid), value)
          } else if  (splitmsg[i].startsWith("BIR")) {
            // Parse DBIR01 (8 bipolar relays)
            const uid = splitmsg[i].substr(0,9).toString();
            const value = parseInt( splitmsg[i].substr(10),16);

            for (var k = 0; k< 7; k++) {
              //platform.log.info("BIR update '%s' to '%i'",uid+"-"+(k+1),value & (2**k));
              platform.updateAccessory(hap.uuid.generate(uid+"-"+(k+1)), value & (2**k));
            }
          } else if  (splitmsg[i].startsWith("DIM")) {
            // Parse DDIM01 (8 dimmer commands)
            const uid = splitmsg[i].substr(0,9).toString();

            for (var k = 0; k < 7;k++) {
              //platform.log.info("DIM update '%s' to '%i'",uid+"-"+(k+1).toString(16),parseInt(splitmsg[i].substr(10+(k*2),2),16));
              platform.updateAccessory(hap.uuid.generate(uid+"-"+(k+1)), parseInt(splitmsg[i].substr(10+(k*2),2),16));
            }

          } else if  (splitmsg[i].startsWith("PRL")) {
            // Parse DPBTLCD0x (LCD Pushbuttons)
            
            //Temperature Heating Value
            if (splitmsg[i].substr(9,1)=="T") {
              const uid = splitmsg[i].substr(0,9).toString();              
              const value = Number(splitmsg[i].substr(10).split(" ")[0]);

              platform.updateAccessory(hap.uuid.generate(uid),value)
            }

          } else if  (splitmsg[i].startsWith("B81")) {
            // Parse DPBL01 (1 Push Button Lythos (and 8 colors))

          } else if  (splitmsg[i].startsWith("B82")) {
            // Parse DPBL02 (2 Push Button Lythos (and 8 colors))

          } else if  (splitmsg[i].startsWith("B84")) {
            // Parse DPBL04 (4 Push Button Lythos (and 8 colors))

          } else if  (splitmsg[i].startsWith("B86")) {
            // Parse DPBL06 (6 Push Button Lythos (and 8 colors))

          } else if  (splitmsg[i].startsWith("DET")) {
            // Parse DET Infrared detector
            const uid = splitmsg[i].substr(0,9).toString();
            const value = parseInt( splitmsg[i].substr(10),16);

            platform.updateAccessory(hap.uuid.generate(uid+'-1'), value & 1);
          } else if  (splitmsg[i].startsWith("I20")) {
            // Parse DISM20 (20 input module)
            
            const uid = splitmsg[i].substr(0,9).toString();
            const value = parseInt(splitmsg[i].substr(14,2) + splitmsg[i].substr(12,2) + splitmsg[i].substr(10,2), 16);

            for (var k = 0; k < 20; k++) {
              //platform.log.info("DISM20 update '%s' to '%i'",uid+"-"+(k+1).toString(16),value & (2**k));
              platform.updateAccessory(hap.uuid.generate(uid+"-"+(k+1).toString(16)), value & (2**k));
            }

          } else if  (splitmsg[i].startsWith("VAR")) {
            // Parse Software Vars
          } else if  (splitmsg[i].startsWith("TRV  25DEO")) {
            // Parse DTRV01 4 shutter inverters
            //Bit 0 Relay 1 = UP
            //Bit 1 Relay 1 = DOWN ...
            platform.log.info("Received: '%s' (unhandled)", splitmsg[i]);

          } else if  (splitmsg[i].startsWith("SYS")) {
            // Parse System parameters

          } else {
            // Parse an unknown message where message is longer than 0
            if (splitmsg[i].length > 0){
              //platform.log.info("Received: '%s' (unhandled)", splitmsg[i]);
            }

          }
        }

      }

    });

    ws.on('close', function() {      
      setTimeout(platform.setupWebSocket, 1000);
    });

  }

  addAccessory(confobject: any) {
    let existingAccessory = false;

    const uuid = hap.uuid.generate(confobject.identifier);

    for (var i = 0; i < this.accessories.length; i++) {
      if (this.accessories[i].UUID === uuid) {
        // The requested accessory already exists, skipping
        existingAccessory = true;
      } 
    }

    if (!existingAccessory) {
      this.log.info("Adding new accessory with name '%s'", confobject.name);
      const accessory = new Accessory(confobject.name, uuid);

      if (confobject.type == "Lightbulb"){
        accessory.context.type = AccessoryType.Lightbulb
        accessory.addService(hap.Service.Lightbulb, confobject.name)
      }
      if (confobject.type == "DimmableLightbulb"){
        accessory.context.type = AccessoryType.Lightbulb
        accessory.addService(hap.Service.Lightbulb, confobject.name)
      }
      if (confobject.type == "Outlet"){
        accessory.context.type = AccessoryType.Outlet
        accessory.addService(hap.Service.Outlet, confobject.name)
      }
      if (confobject.type == "WindowCovering"){
        accessory.context.type = AccessoryType.WindowCovering
        accessory.context.riseTime = confobject.riseTime
        accessory.addService(hap.Service.WindowCovering, confobject.name)
      }
      if (confobject.type == "TemperatureSensor"){
        accessory.context.type = AccessoryType.TemperatureSensor
        accessory.addService(hap.Service.TemperatureSensor, confobject.name)
      }
      if (confobject.type == "ContactSensor"){
        accessory.context.type = AccessoryType.ContactSensor
        accessory.addService(hap.Service.ContactSensor, confobject.name)
      }
      if (confobject.type == "MotionSensor"){
        accessory.context.type = AccessoryType.MotionSensor
        accessory.addService(hap.Service.MotionSensor, confobject.name)
      }

      accessory.context.myData = confobject.identifier;

      this.configureAccessory(accessory); // abusing the configureAccessory here

      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);

    }

  }
/*
  addAccessory(uid:string, name: string, accessorytype: AccessoryType) {
    let existingAccessory = false;

    // generate uuid from Domintell identifier
    const uuid = hap.uuid.generate(uid);

    for (var i = 0; i < this.accessories.length; i++) {
      if (this.accessories[i].UUID === uuid) {
        // The requested accessory already exists, skipping
        existingAccessory = true;
      } 
    }

    if (!existingAccessory) {
      this.log.info("Adding new accessory with name '%s'", name);
      const accessory = new Accessory(name, uuid);

      accessory.context.type = accessorytype;

      if (accessorytype == AccessoryType.Lightbulb) {
        accessory.addService(hap.Service.Lightbulb, name)
      }
      else if (accessorytype == AccessoryType.DimmableLightbulb) {
         accessory.addService(hap.Service.Lightbulb, name)
      }
      else if (accessorytype == AccessoryType.Outlet) {
        accessory.addService(hap.Service.Outlet, name)
      }
      else if (accessorytype == AccessoryType.TemperatureSensor) {
        accessory.addService(hap.Service.TemperatureSensor, name)
      } 
      else if (accessorytype == AccessoryType.MotionSensor) {
        accessory.addService(hap.Service.MotionSensor, name)
      } 
      else if (accessorytype == AccessoryType.ContactSensor) {
        accessory.addService(hap.Service.ContactSensor, name)
      } 
       
      accessory.context.myData = uid;


      this.configureAccessory(accessory); // abusing the configureAccessory here

      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }
*/

  /* Received external information about something, update the status in HomeBridge accordingly */
  updateAccessory(uuid: string, value: number) {
    for (var i = 0; i < this.accessories.length; i++) {
      //this.log.info(this.accessories[i].UUID);
      if (this.accessories[i].UUID === uuid) {
        if (this.accessories[i].context.type == AccessoryType.Lightbulb ){
         if (value == 0) {
            this.accessories[i].getService(hap.Service.Lightbulb)!.updateCharacteristic(hap.Characteristic.On, false);
          } else {
            this.accessories[i].getService(hap.Service.Lightbulb)!.updateCharacteristic(hap.Characteristic.On, true);
          }
        }
        if (this.accessories[i].context.type == AccessoryType.DimmableLightbulb ){
          this.accessories[i].getService(hap.Service.Lightbulb)!.updateCharacteristic(hap.Characteristic.Brightness, value);
          if (value == 0) {
            this.accessories[i].getService(hap.Service.Lightbulb)!.updateCharacteristic(hap.Characteristic.On, false);
          } else {
            this.accessories[i].getService(hap.Service.Lightbulb)!.updateCharacteristic(hap.Characteristic.On, true);
          }
        }
        if (this.accessories[i].context.type == AccessoryType.Outlet ){
          if (value == 0) {
             this.accessories[i].getService(hap.Service.Outlet)!.updateCharacteristic(hap.Characteristic.On, false);
          } else {
             this.accessories[i].getService(hap.Service.Outlet)!.updateCharacteristic(hap.Characteristic.On, true);
          }
        }
        if (this.accessories[i].context.type == AccessoryType.TemperatureSensor ){
          this.accessories[i].getService(hap.Service.TemperatureSensor)!.updateCharacteristic(hap.Characteristic.CurrentTemperature, value);
        }
        if (this.accessories[i].context.type == AccessoryType.MotionSensor ){
          if (value == 0)
            this.accessories[i].getService(hap.Service.MotionSensor)!.updateCharacteristic(hap.Characteristic.MotionDetected, false)
          else
            this.accessories[i].getService(hap.Service.MotionSensor)!.updateCharacteristic(hap.Characteristic.MotionDetected, true)
        }
        if (this.accessories[i].context.type == AccessoryType.ContactSensor ){
          if (value == 0)
            this.accessories[i].getService(hap.Service.ContactSensor)!.updateCharacteristic(hap.Characteristic.ContactSensorState, false)
          else
            this.accessories[i].getService(hap.Service.ContactSensor)!.updateCharacteristic(hap.Characteristic.ContactSensorState, true)
        }
      }
    }
  }

  removeAccessories() {
    // we don't have any special identifiers, we just remove all our accessories

    this.log.info("Removing all accessories");

    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
    this.accessories.splice(0, this.accessories.length); // clear out the array
  }

  discoverAccessories() {
    /* Get APPINFO information from Domintell */
    ws.send('APPINFO');
  }

  createHttpService() {
    this.requestServer = http.createServer(this.handleRequest.bind(this));
    this.requestServer.listen(18081, () => this.log.info("Http server listening on 18081..."));
  }

  private handleRequest(request: IncomingMessage, response: ServerResponse) {
    if (request.url === "/discover") {
      this.discoverAccessories();
    } else if (request.url === "/remove") {
      this.removeAccessories();
    }

    response.writeHead(204); // 204 No content
    response.end();
  }

  // ----------------------------------------------------------------------

}
