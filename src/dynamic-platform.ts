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
    let platform = this;

    var temp;

    // probably parse config or something here
    ws = new WebSocket("wss://192.168.0.250:17481", {rejectUnauthorized:false});
    //platform.connectWebSocket("wss://192.168.0.250:17481");

    log.info("Example platform finished initializing!");

    /*
     * When this event is fired, homebridge restored all cached accessories from disk and did call their respective
     * `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
     * after this event was fired, in order to ensure they weren't added to homebridge already.
     * This event can also be used to start discovery of new accessories.
     */
    api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      log.info("Example platform 'didFinishLaunching'");

      // The idea of this plugin is that we open a http service which exposes api calls to add or remove accessories
      this.createHttpService();
    });

    ws.on('open', function open() {
      // TODO: no support yet for password protected configurations
      ws.send('LOGINPSW@:');
    });

    ws.on('message', function incoming(message: String){
      // We received a message from Domintell, parse it here
      if (message.startsWith("APPINFO")) {
        // APPINFO is always multi-line
        const splitmsg = message.split(/\r\n|\r|\n/);
 
        for (var i = 1; i < splitmsg.length; i++) {
          //log.info("APPINFO line %i: %s", i, splitmsg[i]);
          
          if (splitmsg[i].startsWith("DAL")){
            //platform.discoverAccessories();
            let uid = splitmsg[i].substr(0,12).toString();
            let name = splitmsg[i].split('[')[0].substr(12)
  
            // TODO: Currently assuming all DALI device are TYPE=LED, and are dimmable
            platform.addAccessory(uid, name);
          } else {
            log.info("APPINFO says: '%s'",splitmsg[i]);
          }
        }
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
            const uuid = hap.uuid.generate(uid);
            const value = parseInt( splitmsg[i].substr(13),16);
            if (! isNaN(value)) {
              platform.updateAccessory(uuid, value)
            }
          } else if  (splitmsg[i].startsWith("BIR")) {
            // Parse DBIR01 (8 bipolar relays)
          } else if  (splitmsg[i].startsWith("DIM")) {
            // Parse DDIM01 (8 dimmer commands)

          } else if  (splitmsg[i].startsWith("PRL")) {
            // Parse DPBTLCD0x (LCD Pushbuttons)

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

          } else if  (splitmsg[i].startsWith("I20")) {
            // Parse DISM20 (20 inputes module)

          } else if  (splitmsg[i].startsWith("VAR")) {
            // Parse Software Vars
          } else if  (splitmsg[i].startsWith("TRV")) {
            // Parse DTRV01 4 shutter inverters
            //Bit 0 Relay 1 = UP
            //Bit 1 Relay 1 = DOWN ...

          } else if  (splitmsg[i].startsWith("SYS")) {
            // Parse System parameters

          } else {
            // Parse an unknown message where message is longer than 0
            if (splitmsg[i].length > 0){
              log.info("Received: '%s' (unhandled)", splitmsg[i]);
            }

          }
        }

      }

    });

    /* Set keepalive status. Send a PING command every 15 seconds, before server closes the connection */
    const interval = setInterval(function ping() {
      ws.send('PING');
      connectionTimeout+=1;

      if (connectionTimeout > 1) {
        log.info("Connection timeout currently %i", connectionTimeout)
        // TODO: if connectionTimeout equals 3, reesatablish connection
      }
    }, 15000);
  }

  /* Received external information about something, update the status in HomeBridge accordingly */
  updateAccessory(uuid: String, value: number) {
    for (var i = 0; i < this.accessories.length; i++) {
       //this.log.info(this.accessories[i].UUID);
       if (this.accessories[i].UUID === uuid) {
        this.accessories[i].getService(hap.Service.Lightbulb)!.updateCharacteristic(hap.Characteristic.Brightness, value);
        if (value == 0) {
          this.accessories[i].getService(hap.Service.Lightbulb)!.updateCharacteristic(hap.Characteristic.On, false);
        } else {
          this.accessories[i].getService(hap.Service.Lightbulb)!.updateCharacteristic(hap.Characteristic.On, true);
        }
       }
    }
  }

  /*
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log("Configuring accessory %s", accessory.displayName);

    accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log("%s identified!", accessory.displayName);
    });

    accessory.getService(hap.Service.Lightbulb)!.getCharacteristic(hap.Characteristic.Brightness)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        accessory.context.myBrightness = value;
        callback();
      });
      
      accessory.getService(hap.Service.Lightbulb)!.getCharacteristic(hap.Characteristic.On)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        if (value) {
          if ( accessory.context.myBrightness == undefined){
            accessory.context.myBrightness = 100
          }
          
          let commandstring = accessory.context.myData + '%D'+accessory.context.myBrightness;
          //this.log.info("%s has received power on request (%s)",accessory.displayName, commandstring);   
          ws.send(commandstring);
        } else {
          let commandstring = accessory.context.myData + '%D0';
          //this.log.info("%s has received power off request (%s)",accessory.displayName, commandstring);
          ws.send(commandstring);
        }
        callback();
      });
      
    this.accessories.push(accessory);
  }

  // --------------------------- CUSTOM METHODS ---------------------------

  addAccessory(uid:string, name: string) {
    let existingAccessory = false;

    // generate uuid from Domintell identifier
    const uuid = hap.uuid.generate(uid);

    for (var i = 0; i < this.accessories.length; i++) {
      if (this.accessories[i].UUID === uuid) {
        // The requested accessory already exists, skipping
        existingAccessory = true;
        this.log.info("Not adding accessory '%s'",name)
      } 
    }

    if (!existingAccessory) {
      this.log.info("Adding new accessory with name '%s'", name);
      const accessory = new Accessory(name, uuid);

      accessory.addService(hap.Service.Lightbulb, name);
      accessory.context.myData = uid;

      this.configureAccessory(accessory); // abusing the configureAccessory here

      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
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
    } else if (request.url === "/update") {
      this.updateAccessory("fdfa", 45);
    }

    response.writeHead(204); // 204 No content
    response.end();
  }

  // ----------------------------------------------------------------------

}
