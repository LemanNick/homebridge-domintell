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
  PlatformConfig
} from "homebridge";
import WebSocket from 'ws';
import sha512 from 'crypto';
import { access } from "fs";

const PLUGIN_NAME = "homebridge-plugin-domintell";
const PLATFORM_NAME = "HomebridgeDomintell";

let hap: HAP;
let Accessory: typeof PlatformAccessory;
let ws: WebSocket;
let connectionTimeout = 0;
let platform: HomebridgeDomintell;

let ip: string;
let port: number = 17481;
let username: string = "";
let password: string = "";

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
      return;
      // TODO: probly stop loading plugin any further as we do not know where to connect to
    }
    port = config.port ?? 17481;
    username = config.username ?? "";
    password = config.password ?? "";

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

      let accessoriesToRemove: PlatformAccessory[] = [];
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
          accessoriesToRemove.push(i)
      }
      this.removeAccessory(accessoriesToRemove);
      
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

    if (accessory.context.type == "DimmableLightbulb") {
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
            
            let commandstring = accessory.context.identifier + '%D'+accessory.context.brightness;
            //this.log.info("%s has received power on request (%s)",accessory.displayName, commandstring);   
            ws.send(commandstring);
          } else {
            let commandstring = accessory.context.identifier + '%D0';
            //this.log.info("%s has received power off request (%s)",accessory.displayName, commandstring);
            ws.send(commandstring);
          }
          callback();
        });
    } else if (accessory.context.type == "Lightbulb" ) {
      accessory.getService(hap.Service.Lightbulb)!.getCharacteristic(hap.Characteristic.On)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        if (value) {
          let commandstring = accessory.context.identifier + '%I';
          //this.log.info("%s has received power on request (%s)",accessory.displayName, commandstring);   
          ws.send(commandstring);
        } else {
          let commandstring = accessory.context.identifier + '%O';
          //this.log.info("%s has received power off request (%s)",accessory.displayName, commandstring);
          ws.send(commandstring);
        }
        callback();
      });
    } else if (accessory.context.type == "Outlet" ) {
      accessory.getService(hap.Service.Outlet)!.getCharacteristic(hap.Characteristic.On)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        if (value) {
          let commandstring = accessory.context.identifier + '%I';
          //this.log.info("%s has received power on request (%s)",accessory.displayName, commandstring);   
          ws.send(commandstring);
        } else {
          let commandstring = accessory.context.identifier + '%O';
          //this.log.info("%s has received power off request (%s)",accessory.displayName, commandstring);
          ws.send(commandstring);
        }
        callback();
      });
    } else if (accessory.context.type == "WindowCovering" ) {
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
          ws.send(accessory.context.identifier + '%L');
        } else if (accessory.context.currentPosition < value) {
          //this.log.info("WindowCovering SetTargetPosition: '%i' moving up for %i milliseconds",value, accessory.context.movementDuration/100*targetDuration);
          accessory.context.positionState = hap.Characteristic.PositionState.INCREASING;
          ws.send(accessory.context.identifier + '%H');
        } else {
          accessory.context.positionState = hap.Characteristic.PositionState.STOPPED;
        }

        accessory.context.setInterval = setTimeout( function(){ 
          accessory.context.currentPosition = value;
          accessory.getService(hap.Service.WindowCovering)!.getCharacteristic(hap.Characteristic.CurrentPosition).updateValue(accessory.context.currentPosition);

          accessory.context.positionState = hap.Characteristic.PositionState.STOPPED;
          accessory.getService(hap.Service.WindowCovering)!.getCharacteristic(hap.Characteristic.PositionState).updateValue(accessory.context.positionState);
          
          ws.send(accessory.context.identifier + '%O');

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

    } else if (accessory.context.type == "ControllableFan" ) {

      accessory.getService(hap.Service.Fan)!.getCharacteristic(hap.Characteristic.RotationSpeed)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          accessory.context.RotationSpeed = value;
          callback();
        });
        accessory.getService(hap.Service.Fan)!.getCharacteristic(hap.Characteristic.On)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          if (value) {
            if (accessory.context.RotationSpeed == undefined){
              accessory.context.RotationSpeed = 100
            }
            
            let commandstring = accessory.context.identifier + '%D'+accessory.context.RotationSpeed;
            //this.log.info("%s has received power on request (%s)",accessory.displayName, commandstring);   
            ws.send(commandstring);
          } else {
            let commandstring = accessory.context.identifier + '%D0';
            //this.log.info("%s has received power off request (%s)",accessory.displayName, commandstring);
            ws.send(commandstring);
          }
          callback();
        });

    }
    this.accessories.push(accessory);
  }

  setupWebSocket(){
    platform.log.info("Opening a new connection to Domintell '%s' on port %i",ip,port);

    connectionTimeout = 0;
    ws = new WebSocket("wss://"+ip+":"+port, {rejectUnauthorized:false});
    
    ws.on('message', function incoming(message: String){
      // We received a message from Domintell, parse it here
      if (message.startsWith("INFO:Waiting for LOGINPSW:INFO")) {
        // First generation of login mechanism. No username/password handling needed.
        platform.log.info("Opening session to Domintell")
        ws.send('LOGINPSW@:');
      } else if (message.startsWith("INFO:Waiting for LOGINPSW:NONCE=")) {
        // Send PWD info or login
        if (username.length > 0) {
          platform.log.info("Requesting salt for %s", username);
          ws.send('REQUESTSALT@'+username);
        } else {
          platform.log.info("Sending login info to Domintell")
          ws.send('LOGINPSW@:');
        }
      } else if (message.startsWith("INFO:REQUESTSALT:USERNAME")) {
        platform.log.info("INFO message received: '%s'",message);

        const splitmsg = message.split(":");
        const nonce = splitmsg[3].split("=")[1];
        const salt = splitmsg[4].split("=")[1];
        
        let crypto = require('crypto');
        // platform.log.info("SHA512('azerty1007182019')=%s", crypto.createHash('sha512','azerty1007182019').digest('hex'));
        // platform.log.info("SHA512('azerty1007182019')=%s", sha512.createHash('sha512').update('azerty1007182019').digest('hex'));
        
        const cryptedpasswd = sha512.createHash('sha512').update(nonce+sha512.createHash('sha512').update(password + salt).digest('hex')).digest('hex');

        platform.log.info("login info: username='%s', cryptedpasswd='%s', nonce='%s', salt='%s'",username, cryptedpasswd, nonce, salt)

        // send username and password to Domintell
        ws.send('LOGINPSW@'+username+':'+cryptedpasswd);

      } else if (message.startsWith("APPINFO")) {
        platform.log.info("APPINFO message received: '%s'",message);
      } else if (message.startsWith("INFO:World:INFO")) {
        connectionTimeout = 0;
      } else {
        // Split multi-line messages and iterate through each line
        const splitmsg = message.split(/\r\n|\r|\n/);
        for (var i = 0; i < splitmsg.length; i++) {

          if (splitmsg[i].startsWith("DAL")){
            // Parse DINTDALI01 messages
            const uid = splitmsg[i].substring(0,12);
            const value = parseInt( splitmsg[i].substring(13),16);
            
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
          } else if  (splitmsg[i].startsWith("IS4")) {
            // Parse DISM04 (4 input module)
            
            const uid = splitmsg[i].substr(0,9).toString();
            const value = parseInt(splitmsg[i].substr(14,2) + splitmsg[i].substr(12,2) + splitmsg[i].substr(10,2), 16);

            for (var k = 0; k < 4; k++) {
              //platform.log.info("DISM04 update '%s' to '%i'",uid+"-"+(k+1).toString(16),value & (2**k));
              platform.updateAccessory(hap.uuid.generate(uid+"-"+(k+1).toString(16)), value & (2**k));
            }
          } else if  (splitmsg[i].startsWith("IS8")) {
            // Parse DISM08 (8 input module)
            
            const uid = splitmsg[i].substr(0,9).toString();
            const value = parseInt(splitmsg[i].substr(14,2) + splitmsg[i].substr(12,2) + splitmsg[i].substr(10,2), 16);

            for (var k = 0; k < 8; k++) {
              //platform.log.info("DISM08 update '%s' to '%i'",uid+"-"+(k+1).toString(16),value & (2**k));
              platform.updateAccessory(hap.uuid.generate(uid+"-"+(k+1).toString(16)), value & (2**k));
            }
          } else if  (splitmsg[i].startsWith("I20")) {
            // Parse DISM20 (20 input module)
            
            const uid = splitmsg[i].substr(0,9).toString();
            const value = parseInt(splitmsg[i].substr(14,2) + splitmsg[i].substr(12,2) + splitmsg[i].substr(10,2), 16);

            for (var k = 0; k < 20; k++) {
              //platform.log.info("DISM20 update '%s' to '%i'",uid+"-"+(k+1).toString(16),(value & (2**k)) >> k);
              platform.updateAccessory(hap.uuid.generate(uid+"-"+(k+1).toString(16)), (value & (2**k)) >> k);
            }

          } else if  (splitmsg[i].startsWith("D10")) {
            // Parse DOUT10V02
            const uid = splitmsg[i].substr(0,9).toString();
            const value = parseInt(splitmsg[i].substr(10,2), 16);

            platform.updateAccessory(hap.uuid.generate(uid+'-1'), value);

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
      const accessory = new Accessory(confobject.name, uuid);
      accessory.context = confobject;

      switch(accessory.context.type) {
        case "Lightbulb":
          accessory.addService(hap.Service.Lightbulb, confobject.name);
          break;
        case "DimmableLightbulb":
          accessory.addService(hap.Service.Lightbulb, confobject.name);
          break;
        case "Outlet":
          accessory.addService(hap.Service.Outlet, confobject.name);
          break;
        case "WindowCovering":
          accessory.addService(hap.Service.WindowCovering, confobject.name);
          break;
        case "TemperatureSensor":
          accessory.addService(hap.Service.TemperatureSensor, confobject.name);
          break;
        case "ContactSensor":
          accessory.addService(hap.Service.ContactSensor, confobject.name);
          break;
        case "MotionSensor":
          accessory.addService(hap.Service.MotionSensor, confobject.name);
          break;
        case "ControllableFan":
          accessory.addService(hap.Service.Fan, confobject.name);
          break;
      }

      this.configureAccessory(accessory); // abusing the configureAccessory here

      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.log.info("addAccessory: added new %s accessory with name '%s', identifier='%s'", accessory.context.type, accessory.displayName, accessory.context.identifier)

    }
  }

  /* Received external information about something, update the status in HomeBridge accordingly */
  updateAccessory(uuid: string, value: number) {
    for (var i = 0; i < this.accessories.length; i++) {
      if (this.accessories[i].UUID === uuid) {
        if (this.accessories[i].context.type == "Lightbulb" ){
          this.accessories[i].getService(hap.Service.Lightbulb)!.updateCharacteristic(hap.Characteristic.On, (value != 0));
        }
        if (this.accessories[i].context.type == "DimmableLightbulb" ){
          //this.log.info("updating DimmableLightBulb")
          this.accessories[i].getService(hap.Service.Lightbulb)!.updateCharacteristic(hap.Characteristic.Brightness, value);
          this.accessories[i].getService(hap.Service.Lightbulb)!.updateCharacteristic(hap.Characteristic.On, (value != 0));
        }
        if (this.accessories[i].context.type == "WindowCovering" ){

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
        if (this.accessories[i].context.type == "Outlet" ){
          this.accessories[i].getService(hap.Service.Outlet)!.updateCharacteristic(hap.Characteristic.On, (value != 0));
        }
        if (this.accessories[i].context.type == "TemperatureSensor" ){
          this.accessories[i].getService(hap.Service.TemperatureSensor)!.updateCharacteristic(hap.Characteristic.CurrentTemperature, value);
        }
        if (this.accessories[i].context.type == "MotionSensor" ){
          this.accessories[i].getService(hap.Service.MotionSensor)!.updateCharacteristic(hap.Characteristic.MotionDetected, (value != 0))
        }
        if (this.accessories[i].context.type == "ContactSensor" ){
          // Characteristic.ContactSensorState.CONTACT_DETECTED == 0
          // Characteristic.ContactSensorState.CONTACT_NOT_DETECTED == 1
          this.accessories[i].getService(hap.Service.ContactSensor)!.updateCharacteristic(hap.Characteristic.ContactSensorState, value)
        }
        if (this.accessories[i].context.type == "ControllableFan") {
          this.accessories[i].getService(hap.Service.Fan)!.updateCharacteristic(hap.Characteristic.RotationSpeed, value);
          this.accessories[i].getService(hap.Service.Fan)!.updateCharacteristic(hap.Characteristic.On, (value != 0));
        }
      }
    }
  }

  removeAccessory(accessoriesToRemove: PlatformAccessory[]) {
    //var accessoryList: PlatformAccessory[] = [accessory];
    for (let i = 0 ; i < accessoriesToRemove.length; i++){
      let index = this.accessories.indexOf(accessoriesToRemove[i],0);
      if (index > 0) {
        this.log.info("Removing accessory: %s", this.accessories[index].displayName);
        this.accessories.splice(index,1)
      }

    }
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToRemove);
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
