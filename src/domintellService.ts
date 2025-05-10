import { WebSocket } from 'ws';
import { API, Logging } from 'homebridge';

export class DomintellService {
  private static instance: DomintellService;
  private ws: WebSocket | null = null;
  private ip: string;
  private port: number;
  private username: string;
  private password: string;
  private isConnected: boolean = false;
  private isRunningAppInfo: boolean = false;
  private messageQueue: string[] = [];
  private log: Logging;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private api: API;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private accessories: Map<string, any> = new Map();

  private constructor(ip: string, port: number, username: string, password:string, api: API, log: Logging) {
    this.ip = ip;
    this.port = port;
    this.username = username;
    this.password = password;
    this.api = api;
    this.log = log;
    this.connect();
  }

  public static getInstance(ip: string, port: number, username: string, password:string, api: API, log: Logging): DomintellService {
    if (!DomintellService.instance) {
      DomintellService.instance = new DomintellService(ip, port, username, password, api, log);
    }
    return DomintellService.instance;
  }

  private connect() {
    this.ws = new WebSocket('wss://'+this.ip+':'+this.port, { rejectUnauthorized:false });

    this.ws.on('open', () => {
      this.log.debug('[WebSocket] Connection to Domintell opened...');
      this.isConnected = true;
  
      // Process queued messages
      this.messageQueue.forEach((message) => this.ws?.send(message));
      this.messageQueue = [];
    });

    this.ws.on('message', (data) => {
      const messages = data.toString().split(/\r?\n/); // Split by newline (\n or \r\n)
      for (const message of messages) {
        const trimmedMessage = message.trim();
        if (trimmedMessage.length > 0) {
          this.handleIncomingMessage(trimmedMessage);
        }
      }
    });

    this.ws.on('close', () => {
      this.log.info('WebSocket disconnected. Attempting to reconnect...');
      this.isConnected = false;
      this.stopKeepAlive();
      setTimeout(() => this.connect(), 5000); // Reconnect after 5 seconds
    });

    this.ws.on('error', (error) => {
      this.log.error('WebSocket error:', error);
    });
    
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public registerAccessory(uuid: string, accessory: any) {
    this.accessories.set(uuid, accessory);
    this.log.info(`[domintellService] Registered accessory: ${uuid}`);
  }

  async sendMessage(message: string) {
    if (this.isConnected && this.ws) {
      this.log.debug('[WebSocket] > %s',message);
      this.ws.send(message);
    } else {
      this.messageQueue.push(message);
    }
  }

  // Keep-alive mechanism (sends "HELLO" every 50 seconds)
  private startKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }
    this.keepAliveInterval = setInterval(() => {
      if (this.isConnected) {
        this.sendMessage('HELLO');
      }
    }, 50000); // Send "hello" every 50 seconds
  }

  private stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  private handleIncomingMessage(message: string) {
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)/;

    if (this.isRunningAppInfo) {
      this.log.info(`[WebSocket] < ${message}`);
      if (message.startsWith('END APPINFO')) {
        this.isRunningAppInfo = false;
        this.sendMessage('PING');
      }
      return;
    }

    if (message.startsWith('ERROR')) {
      this.log.error(`[WebSocket] ${message}`);
      return;
    }
    if (message.startsWith('!')) {
      this.log.warn(`[WebSocket] ${message}`);
      return;
    }
    if (timeRegex.test(message)) {
      //time message received
      this.log.debug(`[WebSocket] < ${message}`);
      return;
    }
    if (message.startsWith('INFO:Waiting for LOGINPSW:INFO')) {
      // First generation of login mechanism. No username/password handling needed.
      this.log.info(`[WebSocket] < ${message}`);
      this.sendMessage('LOGINPSW@:');
      return;
    }
    if (message.startsWith('INFO:Waiting for LOGINPSW:NONCE=')) {
      // Send PWD info or login
      this.log.info('[WebSocket] < %s', message);
      if (this.username?.length > 0) {
        this.sendMessage('REQUESTSALT@'+this.username);
      } else {
        this.sendMessage('LOGINPSW@:');
      }
      return;
    }
    if (message.startsWith('INFO:REQUESTSALT:USERNAME')) {
      this.log.info('[WebSocket] < %s', message);
      const splitmsg = message.split(':');
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const nonce = splitmsg[3].split('=')[1];
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const salt = splitmsg[4].split('=')[1];

      //let crypto = require('crypto');
      //const cryptedpasswd = sha512.createHash('sha512').update(nonce+sha512.createHash('sha512').update(this.password + salt).digest('hex')).digest('hex');
      //this.sendMessage('LOGINPSW@'+this.username+':'+cryptedpasswd);
    }
    if (message.startsWith('INFO:Session opened:INFO')) {
      // Session syccessfuly opened
      this.log.info(`[WebSocket] < ${message}`);
      this.startKeepAlive();
      this.sendMessage('APPINFO');
      return;
    }
    if (message.startsWith('INFO:World:INFO')) {
      this.log.debug(`[WebSocket] < ${message}`);
      // Received Keepalive return, dismiss
      return;
    }
    if (message.startsWith('PONG')) {
      this.log.debug(`[WebSocket] < ${message}`);
      return;
    }
    if (message.startsWith('APPINFO')) {
      this.log.info(`[WebSocket] < ${message}`);
      this.isRunningAppInfo = true;
      return;
    }
    if (message.startsWith('Datasheet')) {
      this.log.info(`[WebSocket] < ${message}`);
      return;
    }

    const moduleType = message.substring(0, 3);  // First 3 characters
    let serialNumber = message.substring(3, 9); // Next 6 characters

    const remaining = message.substring(9);
    let dataType = '';
    let data = '';

    if (remaining.startsWith('-')) {
      // If there is a "-", extract the optional part
      const extraChars = moduleType === 'DAL' ? 2 : 1;
      serialNumber += remaining.substring(0, extraChars + 1); // Include the '-'
      dataType = remaining[extraChars + 1]; // Character after the optional part
      data = remaining.substring(extraChars + 2); // Remaining part is data
    } else {
      // No "-", then only one character for data type
      dataType = remaining[0];
      data = remaining.substring(1);
    }
    this.log.info(`[WebSocket] < ${message}`);
    this.handleDomintellUpdate(moduleType, serialNumber, dataType, data);

  }

  private handleDomintellUpdate(moduleType: string, serialNumber: string, dataType: string, data: string) {

    // to get the 'correct' serial number according the config, we need to incorporate parts of the data as well, this is
    // because a single message can contain multiple updates depending in the moduleType

    if (moduleType==='BIR'){
      if (dataType!=='O') { //BIR Module should only be sending out 'O' update
        return;
      }
      for (let k=0; k<8; k++) {

        const uuid = this.api.hap.uuid.generate(`${moduleType}${serialNumber}-${k+1}`);
        const accessory = this.accessories.get(uuid);
        if (!accessory){
          this.log.debug(`[WebSocket] Accessory '${moduleType}${serialNumber}-${k+1}' found, not processing update further...`);
        } else {
          const value = (parseInt(data,16) & (1 << k)) !== 0 ;
          this.log.debug(`'${moduleType}${serialNumber}' updadate value '${value}'`); // i am wondering which value can be returned by domintell
          accessory.updateInformation(value ? 100 : 0);
        }
      }
    }
    
    if (moduleType==='DIM'){
      if (dataType!=='D') {  //DIM Module should only be sending out 'D' update
        return;
      }
      
      for (let k=0; k<8; k++) {
        const uuid = this.api.hap.uuid.generate(`${moduleType}${serialNumber}-${k+1}`);
        const accessory = this.accessories.get(uuid);
        if (!accessory){
          this.log.debug(`[WebSocket] Accessory '${moduleType}${serialNumber}-${k+1}' found, not processing update further...`);
        } else {
          const value = parseInt(data.substring(k*2,2),16);
          accessory.updateInformation(value);
        }
      }
    }

    if (moduleType==='DAL'){
      if (dataType!=='D') { //DAL Module should only be sending out 'D' update
        return;
      }

      const uuid = this.api.hap.uuid.generate(`${moduleType}${serialNumber}`);
      const accessory = this.accessories.get(uuid);
      if (!accessory){
        this.log.debug(`[WebSocket] Accessory '${moduleType}${serialNumber}' found, not processing update further...`);
        return;
      }
      const value = parseInt(data,16);
      accessory.updateInformation(value);
    }

    if (moduleType==='PRL'){
      if (dataType!=='B' && dataType!=='O' && dataType!=='T' && dataType!=='U' && dataType!=='I') {
        return;
      }

      if (dataType==='T') {
        // Temperature Heating setpoint '20.5 22.0 AUTO 18.0'
        //  1st Temperature = measure (with software offset)
        //  2nd Temperature = Heating setpoint value
        //  Sensor T mode
        //  3rd Temperature = Heating profile value
        const values = data.split(' ');
        const currentTemp = Number(values[0]);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const heatingSetpoint = Number(values[1]);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const sensorMode = values[2];
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const heatingProfile = Number(values[3]);

        const uuid = this.api.hap.uuid.generate(`${moduleType}${serialNumber}`);
        const accessory = this.accessories.get(uuid);
        if (!accessory){
          this.log.debug(`[WebSocket] Accessory '${moduleType}${serialNumber}' found, not processing update further...`);
          return;
        }
        accessory.updateInformation(currentTemp);
  
      }

      if (dataType==='U') {
        // Temperature Cooling setpoint '20.5 22.0 HEATING 18.0'
        //  1st Temperature = measure (with software offset)
        //  2nd Temperature = cooling setpoint value
        //  Sensor T mode
        //  3rd Temperature = cooling profile value

        const values = data.split(' ');
        const currentTemp = Number(values[0]);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const heatingSetpoint = Number(values[1]);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const sensorMode = values[2];
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const heatingProfile = Number(values[3]);
        const uuid = this.api.hap.uuid.generate(`${moduleType}${serialNumber}`);
        const accessory = this.accessories.get(uuid);
        if (!accessory){
          this.log.debug(`[WebSocket] Accessory '${moduleType}${serialNumber}' found, not processing update further...`);
          return;
        }
        accessory.updateInformation(currentTemp);

      }

      if (dataType==='B') {
        // 'PRL     CB0101' -> Push Button 1 on DPBRLCD02 with serial number 0x00000C
        // 'PRL     CB0100' -> Release Button 1 on DPBRLCD02 with serial number 0x00000C
      }

      if (dataType==='O') {
        // 'PRL     CO00' -> DPBRLCD02 with serial number 0x00000C outputs are OFF
        // 'PRL     CO02' -> 2nd DPBRLCD02 with serial number 0x00000C output is ON
      }


    }

    if (moduleType==='DET'){
      if (dataType!=='I') { //DET Module should only be sending out 'I' update
        return;
      }

      const uuid = this.api.hap.uuid.generate(`${moduleType}${serialNumber}`);
      const accessory = this.accessories.get(uuid);
      if (!accessory){
        this.log.debug(`[WebSocket] Accessory '${moduleType}${serialNumber}' found, not processing update further...`);
        return;
      }

      const value = parseInt(data,16);
      accessory.updateInformation(value); 
    }

    if (moduleType==='VAR'){
      if (dataType!=='O' && dataType!=='D') { //VAR Module should only be sending out 'O' and 'D' update
        return;
      }

      const uuid = this.api.hap.uuid.generate(`${moduleType}${serialNumber}`);
      const accessory = this.accessories.get(uuid);
      if (!accessory){
        this.log.debug(`[WebSocket] Accessory '${moduleType}${serialNumber}' found, not processing update further...`);
        return;
      }

      const value = parseInt(data,16);
      accessory.updateInformation(value); 
    }

  }

  /*
   * Send Data to Domintell
   */
  async setActionDimmerValue(uuid: string, value: number) {
    const accessory = this.accessories.get(uuid);
    if (!accessory){
      this.log.debug(`Accessory with uuid='${uuid}' not found...`);
    }
    const platformAccessory = accessory.getAccessory();

    this.sendMessage(`${platformAccessory.context.device.identifier}%D${value}`);
  }

  async setActionOn(uuid: string) {
    const accessory = this.accessories.get(uuid);
    if (!accessory){
      this.log.debug(`Accessory with uuid='${uuid}' not found...`);
    }
    const platformAccessory = accessory.getAccessory();

    this.sendMessage(`${platformAccessory.context.device.identifier}%I`);
  }

  async setActionOff(uuid: string) {
    const accessory = this.accessories.get(uuid);
    if (!accessory){
      this.log.debug(`Accessory with uuid='${uuid}' not found...`);
    }
    const platformAccessory = accessory.getAccessory();

    this.sendMessage(`${platformAccessory.context.device.identifier}%O`);
  }    

}