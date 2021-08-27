import http, {IncomingMessage, Server, ServerResponse} from "http";
import {
  API,
  APIEvent,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
  CharacteristicValue,
  DynamicPlatformPlugin,
  HAP,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  PlatformConfig,
} from "homebridge";
import WebSocket from 'ws';
import { setServers } from "dns";
import { callbackify } from "util";
import { access } from "fs";

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
  private positionPollInterval: number;

  private requestServer?: Server;

  private readonly accessories: PlatformAccessory[] = [];

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.api = api;
    platform = this;

    this.positionPollInterval = 1000;

    if (config.ip) {
      ip = config.ip;
    }
    else {
      log.error("No IP address specified in config..."); 
      return;
      // TODO: probly stop loading plugin any further as we do not know where to connect to
    }
    port = config.port || 17481;

    /*
     * When this event is fired, homebridge restored all cached accessories from disk and did call their respective
     * `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
     * after this event was fired, in order to ensure they weren't added to homebridge already.
     * This event can also be used to start discovery of new accessories.
     */
    api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      this.setupWebSocket();

      // Parse config file, and add accessories
      if (config.accessories.length > 0) {
        for (var confacc of config.accessories) {
          platform.addAccessory(confacc);
        }
      }

      /*
       * Iterate over configured accessories and remove them if they are not mentioned or configured in the config file
       */
      for (var i of this.accessories) {
        let accessoryFound = false;
        for (var k of config.accessories) {
         if (i.UUID == hap.uuid.generate(k.identifier))
          accessoryFound=true;
        }
        if (accessoryFound == false)
          this.removeAccessory(i)
      }
      
      // The idea of this plugin is that we open a http service which exposes api calls to add or remove accessories
      this.createHttpService();
    });

    /* 
     * Set keepalive status. Send a PING command every 15 seconds, this keeps the connection to Domintell open 
     */
    const interval = setInterval(function hello() {
      ws.send('HELLO');
      connectionTimeout+=1;

      if (connectionTimeout >= 3) {
        log.info("Connection timeout currently %i", connectionTimeout)
        // TODO: if connectionTimeout equals 3, reesatablish connection
      }
    }, 50000);
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
    } else if (accessory.context.type == AccessoryType.WindowCovering ) {
      accessory.getService(hap.Service.WindowCovering)!.getCharacteristic(hap.Characteristic.CurrentPosition)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        if (accessory.context.currentPosition == undefined) {
          accessory.context.currentPosition = 100
        }
        accessory.context.currentPosition = Math.min(accessory.context.currentPosition, 100)
        accessory.context.currentPosition = Math.max(accessory.context.currentPosition, 0)
        //this.log.info("WindowCovering GetCurrentPosition returning: %i",accessory.context.currentPosition)
        return callback(null,accessory.context.currentPosition);
      });

      accessory.getService(hap.Service.WindowCovering)!.getCharacteristic(hap.Characteristic.PositionState)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        if (accessory.context.positionState == undefined)
          accessory.context.positionState = hap.Characteristic.PositionState.STOPPED
        //this.log.info("WindowCovering GetPositionState returning %i", accessory.context.positionState)
        return callback(null,accessory.context.positionState);
      });

      accessory.getService(hap.Service.WindowCovering)!.getCharacteristic(hap.Characteristic.PositionState)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        //this.log.info("WindowCovering SetPositionState was called with value '%i' (doc. says we should be called)", value)
        return callback();
      });


      accessory.getService(hap.Service.WindowCovering)!.getCharacteristic(hap.Characteristic.TargetPosition)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {

        accessory.context.targetPosition = value;

        clearTimeout( accessory.context.setInterval);
        accessory.context.setInterval = null;

        // if we were moving when receiving a new target position, we should calculate what our new current possition was, 
        switch (accessory.context.positionState) {
          case hap.Characteristic.PositionState.DECREASING:
            accessory.context.currentPosition -= ((new Date().getTime() - accessory.context.startMovementTimeStamp)/accessory.context.movementDuration)*100
            accessory.context.startMovementTimeStamp = new Date().getTime();
            break;
          case hap.Characteristic.PositionState.INCREASING:
            accessory.context.currentPosition += ((new Date().getTime() - accessory.context.startMovementTimeStamp)/accessory.context.movementDuration)*100
            accessory.context.startMovementTimeStamp = new Date().getTime();
            break;
          case hap.Characteristic.PositionState.STOPPED:
            accessory.context.startMovementTimeStamp = new Date().getTime();
            break;
        }

        accessory.context.currentPosition = Math.min(accessory.context.currentPosition,100);
        accessory.context.currentPosition = Math.max(accessory.context.currentPosition,0);

        let targetDuration: number = Math.abs(parseInt(value.toString()) - accessory.context.currentPosition);
             
        if (accessory.context.currentPosition > value) {
          //this.log.info("WindowCovering SetTargetPosition: '%i' moving down for %i milliseconds",value, accessory.context.movementDuration/100*targetDuration);
          accessory.context.positionState = hap.Characteristic.PositionState.DECREASING;
          ws.send(accessory.context.myData + '%L');
        } else if (accessory.context.currentPosition < value) {
          //this.log.info("WindowCovering SetTargetPosition: '%i' moving up for %i milliseconds",value, accessory.context.movementDuration/100*targetDuration);
          accessory.context.positionState = hap.Characteristic.PositionState.INCREASING;
          ws.send(accessory.context.myData + '%H');
        } else {
          accessory.context.positionState = hap.Characteristic.PositionState.STOPPED;
        }

        accessory.context.setInterval = setTimeout( function(){ 
          accessory.context.currentPosition = value;
          accessory.getService(hap.Service.WindowCovering)!.getCharacteristic(hap.Characteristic.CurrentPosition).updateValue(accessory.context.currentPosition);

          accessory.context.positionState = hap.Characteristic.PositionState.STOPPED;
          accessory.getService(hap.Service.WindowCovering)!.getCharacteristic(hap.Characteristic.PositionState).updateValue(accessory.context.positionState);
          
          ws.send(accessory.context.myData + '%O');

          accessory.context.setInterval = null;

        }, accessory.context.movementDuration/100*targetDuration);
        
        callback();
      });

      accessory.getService(hap.Service.WindowCovering)!.getCharacteristic(hap.Characteristic.TargetPosition)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        if (accessory.context.targetPosition == undefined) {
          accessory.context.targetPosition = 100;
        }
        accessory.context.targetPosition = Math.min(accessory.context.targetPosition, 100)
        accessory.context.targetPosition = Math.max(accessory.context.targetPosition, 0)
        return callback(null,accessory.context.targetPosition);
      });

    } else if (accessory.context.type == AccessoryType.TemperatureSensor ) {
      //set Celcius as temperature unit
      accessory.getService(hap.Service.TemperatureSensor)!.updateCharacteristic(hap.Characteristic.TemperatureDisplayUnits, 0);
   }
      
    this.accessories.push(accessory);
  }

  setupWebSocket(){
    platform.log.info("Opening a new connection to Domintell '%s' on port %i",ip,port);

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
      } else if (message.startsWith("INFO:World:INFO")) {
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
          } else if  (splitmsg[i].startsWith("TRV")) {
            // Parse DTRV01 4 shutter inverters

            const uid = splitmsg[i].substr(0,9).toString();
            const value = parseInt(splitmsg[i].substr(10,2), 16);

            for (let k = 0; k < 4 ; k++) {
              //platform.log.info("TRV update '%s' to '%i'",uid+"-"+((k*2)+1), (value & (3 << (k*2))) >> (k*2));
              platform.updateAccessory(hap.uuid.generate(uid+"-"+((k*2)+1)),(value & (3 << (k*2))) >> (k*2))
            }

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
        if (confobject.type == "WindowCovering")
          this.accessories[i].context.movementDuration = confobject.movementDuration;
      } 
    }

    if (!existingAccessory) {
      this.log.info("Adding new accessory with name '%s'", confobject.name);
      const accessory = new Accessory(confobject.name, uuid);

      if (confobject.type == "Lightbulb"){
        accessory.context.type = AccessoryType.Lightbulb;
        accessory.addService(hap.Service.Lightbulb, confobject.name);
      }
      if (confobject.type == "DimmableLightbulb"){
        accessory.context.type = AccessoryType.Lightbulb;
        accessory.addService(hap.Service.Lightbulb, confobject.name);
      }
      if (confobject.type == "Outlet"){
        accessory.context.type = AccessoryType.Outlet;
        accessory.addService(hap.Service.Outlet, confobject.name);
      }
      if (confobject.type == "WindowCovering"){
        accessory.context.type = AccessoryType.WindowCovering;
        accessory.context.movementDuration = confobject.movementDuration;
        accessory.addService(hap.Service.WindowCovering, confobject.name);
      }
      if (confobject.type == "TemperatureSensor"){
        accessory.context.type = AccessoryType.TemperatureSensor;
        accessory.addService(hap.Service.TemperatureSensor, confobject.name);
      }
      if (confobject.type == "ContactSensor"){
        accessory.context.type = AccessoryType.ContactSensor;
        accessory.addService(hap.Service.ContactSensor, confobject.name);
      }
      if (confobject.type == "MotionSensor"){
        accessory.context.type = AccessoryType.MotionSensor;
        accessory.addService(hap.Service.MotionSensor, confobject.name);
      }

      accessory.context.myData = confobject.identifier;

      this.configureAccessory(accessory); // abusing the configureAccessory here

      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);

    }

  }

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
        if (this.accessories[i].context.type == AccessoryType.WindowCovering ){

          // filter out to handle manual updates only
          if (isNaN(this.accessories[i].context.setInterval) || this.accessories[i].context.setInterval === null) {

            // if the blinds were already moving on Domintell update message, calculate what the currentPosition will be.
            switch (this.accessories[i].context.positionState) {
              case hap.Characteristic.PositionState.DECREASING:
                this.accessories[i].context.currentPosition -= ((new Date().getTime() - this.accessories[i].context.startMovementTimeStamp)/this.accessories[i].context.movementDuration)*100
                break;
              case hap.Characteristic.PositionState.INCREASING:
                this.accessories[i].context.currentPosition += ((new Date().getTime() - this.accessories[i].context.startMovementTimeStamp)/this.accessories[i].context.movementDuration)*100
                break;
              case hap.Characteristic.PositionState.STOPPED:
                break;
            }

            this.accessories[i].context.currentPosition = Math.min(this.accessories[i].context.currentPosition,100)
            this.accessories[i].context.currentPosition = Math.max(this.accessories[i].context.currentPosition,0)

            // Domintell dictates the direction
            switch (value) {
              case 0:
                this.accessories[i].context.positionState = hap.Characteristic.PositionState.STOPPED;
                this.accessories[i].context.targetPosition = this.accessories[i].context.currentPosition;
                break;
              case 1: 
                this.accessories[i].context.positionState = hap.Characteristic.PositionState.INCREASING;
                this.accessories[i].context.targetPosition = 100;
                this.accessories[i].context.startMovementTimeStamp = new Date().getTime();
                break;
              case 2: 
                this.accessories[i].context.positionState = hap.Characteristic.PositionState.DECREASING;
                this.accessories[i].context.targetPosition = 0;
                this.accessories[i].context.startMovementTimeStamp = new Date().getTime();
                break;
            }
            //this.log.info("WindowCover manual adjustment CurrentPosition=%i and TargetPosition=%i",this.accessories[i].context.currentPosition, this.accessories[i].context.targetPosition);
            this.accessories[i].getService(hap.Service.WindowCovering)!.getCharacteristic(hap.Characteristic.PositionState).updateValue(this.accessories[i].context.positionState);
            this.accessories[i].getService(hap.Service.WindowCovering)!.getCharacteristic(hap.Characteristic.TargetPosition).updateValue(this.accessories[i].context.targetPosition);
            this.accessories[i].getService(hap.Service.WindowCovering)!.getCharacteristic(hap.Characteristic.CurrentPosition).updateValue(this.accessories[i].context.currentPosition);
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

  removeAccessory(accessory: PlatformAccessory) {
    var accessoryList: PlatformAccessory[] = [accessory];
    let index = this.accessories.indexOf(accessory,0);

    this.log.info("Removing accessory: %s (index: %i)", accessory.displayName, index);

    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoryList);

    this.accessories.splice(index,1)
  }

  requestAppInfo() {
    ws.send('APPINFO');
  }

  createHttpService() {
    this.requestServer = http.createServer(this.handleRequest.bind(this));
    this.requestServer.listen(18081, () => this.log.info("Http server listening on 18081..."));
  }

  private handleRequest(request: IncomingMessage, response: ServerResponse) {
    if (request.url === "/appinfo") {
      this.requestAppInfo();
    }

    response.writeHead(204); // 204 No content
    response.end();
  }

}
