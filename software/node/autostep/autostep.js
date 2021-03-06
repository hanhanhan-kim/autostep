"use strict";
const _ = require('lodash');

let SerialDevice = require('./serialdevice');

const BAUDRATE = 115200;
const BUSYWAIT_TIMEOUT_MS = 10;
const AUTOSET_POSITION_START_ANGLE = 5.0; 
const DEFAULT_GEAR_RATIO = 1.0;
const MOVE_MODE_UNITS = { 
  speed: '(deg/sec)', 
  accel: '(deg/sec**2)', 
  decel: '(deg/sec**2)' 
};


const timeout = ms => new Promise(res => setTimeout(res, ms));

class Autostep {

  constructor(port, openCallback) {
    const options = {baudRate: BAUDRATE};
    this.device = new SerialDevice(port,options,openCallback);
    this.gearRatio = DEFAULT_GEAR_RATIO;
    this.sinusoidRunning = false;
  }

  static createNew(port) {
    return new Promise((resolve,reject) => {
      const newAutostep = new Autostep(port,() => {
        resolve(newAutostep);
      });
    });
  }

  setGearRatio(gearRatio) {
    this.gearRatio = gearRatio;
  }

  enable(callback) { 
    const cmd = {command: 'enable'};
    return this._sendCmd(cmd,callback);
  }

  release(callback) {
    const cmd = {command: 'release'};
    return this._sendCmd(cmd,callback);
  }

  async run(velocity, callback) {
    const velocityAdj = this.gearRatio*velocity;
    const cmd = {command: 'run', velocity: velocityAdj};
    return this._sendCmd(cmd,callback);
  }

  async sinusoid(params,cmdCallback,streamCallback) {
    // Adjust parameters for gear ratio
    const paramsAdj = _.cloneDeep(params);
    paramsAdj.amplitude = paramsAdj.amplitude*this.gearRatio;
    paramsAdj.offset = paramsAdj.offset*this.gearRatio;

    // Send command to driver
    const cmd = {command: 'sinusoid', ...paramsAdj};
    let streamCallbackWrapped = (err,data) => {
      if (err || _.isEmpty(data)) {
        this.sinusoidRunning = false;
      }
      if (streamCallback) { 
        streamCallback(err,data);
      }
    }
    this.device.setStreamCallback(streamCallbackWrapped);
    this.sinusoidRunning = true;
    const rsp = await this._sendCmd(cmd,cmdCallback);

    // Adjust response for gear ratio
    let rspAdj = _.cloneDeep(rsp);
    rspAdj.amplitude = rspAdj.amplitude/this.gearRatio;
    rspAdj.offset = rspAdj.offset/this.gearRatio;
    return rspAdj;
  }

  moveToSinusoidStart(params,callback) {
    const phaseInRadian = degreeToRadian(params.phase);
    const startAngle = params.amplitude*Math.sin(phaseInRadian) + params.offset;
    return this.moveTo(startAngle,callback);
  }

  moveTo(position, callback) {
    const positionAdj = position*this.gearRatio;
    const cmd = {command: 'move_to', position: positionAdj};
    return this._sendCmd(cmd,callback);
  }

  async moveBy(step, callback) {
    const rsp = await this.getPosition();
    return this.moveTo(rsp.position + step, callback);
  }

  moveToFullsteps(position, callback) {
    const cmd = {command: 'move_to_fullsteps', position: position};
    return this._sendCmd(cmd,callback);
  }

  moveToMicrosteps(position, callback) {
    const cmd = {command: 'move_to_microsteps', position: position};
    return this._sendCmd(cmd,callback);
  }

  softStop(callback) {
    const cmd = {command: 'soft_stop'};
    return this._sendCmd(cmd,callback);
  }

  hardStop(callback) {
    const cmd = {command: 'hard_stop'};
    return this._sendCmd(cmd,callback);
  }

  isBusy(callback) {
    const cmd = {command: 'is_busy'}
    return this._sendCmd(cmd,callback);
  }

  busyWait(callback) {
    const promise = new Promise( async (resolve,reject) => {
      let done = false;
      while (!done) {
        await timeout(BUSYWAIT_TIMEOUT_MS);
        if (this.sinusoidRunning) {
          if (!this.sinusoidRunning) {
            done = true;
          }
        } else {
          let rsp = await this.isBusy();
          if (rsp.success) {
            done = !rsp['is_busy']
          } else {
            done = true;
          }
        }
      }
      resolve();
    });

    if (callback && typeof callback == 'function') {
      promise
        .then((rsp) => callback(null,rsp))
        .catch((err) => callback(err,null));
    }
    return promise;
  }

  setMoveModeToMax(callback) {
    const cmd = {command: 'set_max_mode'};
    return this._sendCmd(cmd,callback);
  }

  setMoveModeToJog(callback) {
    const cmd = {command: 'set_jog_mode'};
    return this._sendCmd(cmd,callback);
  }

  async getPosition(callback) {
    const cmd = {command: 'get_position'};
    const rsp = await this._sendCmd(cmd,callback);
    let rspAdj = _.cloneDeep(rsp);
    rspAdj.position = rspAdj.position/this.gearRatio;
    return rspAdj;
  }

  setPosition(position,callback) {
    const positionAdj = position*this.gearRatio;
    const cmd = {command: 'set_position', position: positionAdj};
    return this._sendCmd(cmd,callback);
  }

  getPositionFullsteps(callback) {
    const cmd = {command: 'get_position_fullsteps'};
    return this._sendCmd(cmd,callback);
  }

  getPositionMicrosteps(callback) {
    const cmd = {command: 'get_position_microsteps'};
    return this._sendCmd(cmd,callback);
  }

  getPositionSensor(callback) {
    const cmd = {command: 'get_position_sensor'};
    return this._sendCmd(cmd, callback);
  }

  getVoltageSensor(callback) {
    const cmd = {command: 'get_voltage_sensor'};
    return this._sendCmd(cmd,callback);
  }

  autosetPosition(callback) {
    const cmd = {command: 'autoset_position'};
    return this._sendCmd(cmd,callback);
  }

  autosetPositionProcedure(callback) {
    const promise = new Promise(async (resolve,reject) => {
      let rsp = null;
      rsp = await this.autosetPosition();
      if (!rsp.success) {
        reject('autoset: set position failed');
      }

      rsp = await this.moveTo(AUTOSET_POSITION_START_ANGLE);
      if (!rsp.success) {
        reject('autoset: move to start position failed');
      }
      await this.busyWait();

      rsp = await this.autosetPosition();
      if (!rsp.success) {
        reject('autoset: set position failed');
      }
    });
  }

  getStepMode(callback) {
    const cmd = {command: 'get_step_mode'};
    return this._sendCmd(cmd, callback);
  }

  setStepMode(stepMode, callback) {
    const cmd = {command: 'set_step_mode', step_mode: stepMode};
    return this._sendCmd(cmd, callback);
  }

  getFullstepPerRev(callback) {
    const cmd = {command: 'get_fullstep_per_rev'};
    return this._sendCmd(cmd, callback);
  }

  setFullstepPerRev(fullstepPerRev,callback) {
    const fullstepPerRevInt = Number(fullstepPerRev.toFixed(0));
    const cmd = {command: 'set_fullstep_per_rev', fullstep_per_rev: fullstepPerRevInt};
    return this._sendCmd(cmd, callback);
  }

  getJogModeParams(callback) {
    const cmd = {command: 'get_jog_mode_params'};
    return this._sendCmd(cmd, callback);
  }

  setJogModeParams(params, callback) {
    const cmd = {command: 'set_jog_mode_params', ...params};
    return this._sendCmd(cmd, callback);
  }

  getMaxModeParams(callback) {
    const cmd = {command: 'get_max_mode_params'};
    return this._sendCmd(cmd, callback);
  }

  setMaxModeParams(params, callback) {
    const cmd = {command: 'set_max_mode_params', ...params};
    return this._sendCmd(cmd, callback);
  }

  getKvalParams(callback) {
    const cmd = {command: 'get_kval_params'};
    return this._sendCmd(cmd, callback);
  }

  setKvalParams(params,callback) {
    const cmd = {command: 'set_kval_params', ...params};
    return this._sendCmd(cmd, callback);
  }

  getOCThreshold(callback) {
    const cmd = {command: 'get_oc_threshold'};
    return this._sendCmd(cmd, callback);
  }

  setOCThreshold(threshold, callback) {
    const cmd = {command: 'set_oc_threshold', threshold: threshold};
    return this._sendCmd(cmd, callback);
  }

  async setParams(params) {
    let paramSetters = {
      'fullstepPerRev' : 'setFullstepPerRev', 
      'stepMode'       : 'setStepMode', 
      'threshold'      : 'setOCThreshold',
      'jogMode'        : 'setJogModeParams', 
      'maxMode'        : 'setMaxModeParams', 
      'kval'           : 'setKvalParams',
    };

    for (let paramName in paramSetters) {
      let paramValue = params[paramName];
      let setterName = paramSetters[paramName];
      let setterMethod = this[setterName].bind(this);
      if (params[paramName]) {
        let rsp = await setterMethod(params[paramName]);
        if (!rsp.success) {
          return rsp;
        }
      }
    } 
    return {'success': true};
  }

  async getParams() {
    let rsp = await this.getFullstepPerRev();
    let fullstepPerRev = rsp['fullstep_per_rev'];

    rsp = await this.getStepMode();
    let stepMode = rsp['step_mode'];

    rsp = await this.getOCThreshold();
    let threshold = rsp['threshold'];

    let jogModeParams = await this.getJogModeParams();
    delete jogModeParams.success;

    let maxModeParams = await this.getMaxModeParams();
    delete maxModeParams.success;

    let kvalParams = await this.getKvalParams();
    delete kvalParams.success;

    let params = {
      'fullstepPerRev' : fullstepPerRev,
      'stepMode' : stepMode,
      'threshold' : threshold,
      'jogMode' : jogModeParams,
      'maxMode' : maxModeParams,
      'kval': kvalParams,
      };

    return params;

  }

  async printParams() {

    let params = await this.getParams();

    console.log();
    console.log('Autostep params');
    console.log('---------------------------');
    console.log();
    console.log('fullstep/rev: ' + params.fullstepPerRev);
    console.log('step mode:    ' + params.stepMode);
    console.log('oc threshold  ' + params.threshold);
    console.log();

    let printMoveModeParams = (params) =>  {
      for (let key in params) {
        let value = params[key];
        let units = MOVE_MODE_UNITS[key];
        console.log('  ' + _.padEnd(key,5) + ': ' + value + ' ' + units);
      }
    };
    console.log('jog mode:');
    printMoveModeParams(params.jogMode);
    console.log();

    console.log('max mode: ');
    printMoveModeParams(params.maxMode);
    console.log();

    console.log('kvals (0-255)');
    for (let key in params.kval) {
      let value = params.kval[key];
      console.log('  ' + _.padEnd(key,5) + ': ' + value);
    }
    console.log('---------------------------');
    console.log();
  }


  sleep(sec) {
    return timeout(sec*1000.0);
  }


  // ------------------------------------------------------------------------------------

  _sendCmd(cmd, callback) {
    const promise = new Promise((resolve,reject) => {
      this.device.sendCmd(JSON.stringify(cmd), (err,rsp) => {
        if (err) {
          reject(err);
        } else {
          let rspObj = null;
          try {
            rspObj = JSON.parse(rsp);
          } catch(err) {
            reject(err);
          }
          resolve(rspObj);
        }
      });
    });
    if (callback && typeof callback == 'function') {
      promise
        .then(  (rsp) => callback(null,rsp))
        .catch( (err) => callback(err,null));
    }
    return promise;
  }
}

let degreeToRadian = function(x) {
  return (x*Math.PI)/180.0;

}

let radianToDegree = function(x) {
  return (x*180.0)/Math.PI;
}

module.exports = Autostep;
