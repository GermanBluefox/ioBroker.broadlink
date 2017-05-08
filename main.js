'use strict';
var utils = require(__dirname + '/lib/utils');
var adapter = new utils.Adapter('broadlink');
var Broadlink = require(__dirname + '/lib/broadlink');
var namespaceChannelLearned = 'learnedSignals';
var currentDevice;
var tasks = [];

var reCODE = /^CODE_|^/;
var reIsCODE = /^CODE_[a-f0-9]{16}/;
var codes = {};
var defaultName = '>>> Learned, please describe';

adapter.on('unload', function (callback) {
	try {
		if (currentDevice) {
			currentDevice.closeConnection();
			currentDevice = null;
			adapter.setState('info.connection', false, true);
		}
		adapter.log.info('Closed connection/listener');
		callback();
	} catch (e) {
		callback();
	}
}).on('objectChange', function (id, obj) {
	if (!id || !obj) {
		if (id && codes[id]) delete codes[id];
		return;
	}
	
	addCode(id, obj);
	
	if (obj.type === 'channel' || obj.type === 'device') {
		tasks.push(id);
		if (tasks.length === 1) {
			createLearningModeState(id);
		}
	}
}).on('stateChange', function (id, state) {
	if (!state || state.ack || id.indexOf(adapter.namespace) !== 0 || !currentDevice) return;

	var ar = id.split('.');
	var command = ar[ar.length - 1];

	switch (command) {
		case 'enableLearningMode':
		case 'createCode':
			if (!state.val) break;

			var aktChannel = '';
			var name = '';
			if (typeof state.val === 'string') {
				var nar = state.val.split('.');
				name = nar.pop();
				aktChannel = nar.join('.');
				aktChannel = aktChannel [0] === '.' ? aktChannel.substr(1) : namespaceChannelLearned + '.' + aktChannel;
			} else {
				for (var i = 2; i < ar.length - 1; i++) {
					aktChannel = aktChannel ? aktChannel + '.' + ar[i] : ar[i];
				}
			}
			enterLeaningMode(aktChannel, name);
			break;
		
		case 'sendCode':
			var code = state.val.replace(reCODE, 'CODE_');
			if (isSignalCode(code)) {
				sendCode(code);
			}
			break;
		
		default:
			adapter.log.debug('Preparing to send: ' + command);

			if (isSignalCode(command)) {
				sendCode(command);
			} else if (codes[id]) {
				sendCode(codes[id]);
			}
			break;
		//     // If the object is not a signal code, check the name of the object
		//     adapter.getObject (id, function (err, obj) {
		//         if (err || !obj) {
		//             adapter.log.error (err);
		//         } else if (obj.native && obj.native.keyCode) {
		//             sendCode (obj.native.keyCode);
		//         } else if (obj.common.name) {
		//             if (isSignalCode (obj.common.name)) {
		//                 sendCode (obj.common.name)
		//             }
		//         }
		//     });
		// }
	}

// }).on('stateChange', function (id, state) {
// 	if (currentDevice) {
// 		if (state && !state.ack && id.indexOf(adapter.namespace) === 0) {
// 		    var ar = id.split('.');
// 		    if (ar[ar.length-1] === 'enableLearningMode') {
//                 if (state.val) {
//                     var aktChannel = '', name = '';
//                     for (var i=2; i<ar.length-1; i++) {
//                         aktChannel = aktChannel ? aktChannel + '.' + ar[i] : ar[i];
//                     }
//                     if (typeof state.val === 'string') {
//                         var nar = state.val.split('.');
//                         name = nar.pop();
//                         aktChannel = nar.join('.');
//                         aktChannel = aktChannel [0] === '.' ? aktChannel.substr(1) : namespaceChannelLearned + '.' + aktChannel;
//                     }
//                     enterLeaningMode(aktChannel, name);
//                 }
// 			} else {
// 				var objectIdCode = id.split('.').pop();
// 				adapter.log.debug('Preparing to send: ' + objectIdCode);
//
// 				if (isSignalCode(objectIdCode)) {
// 					sendCode(objectIdCode);
// 				} else {
// 					// If the object is not a signal code, check the name of the object
// 					adapter.getObject(id, function (err, obj) {
// 						if (err) {
// 							adapter.log.error(err);
// 						} else if (obj.common.name) {
// 							if (isSignalCode(obj.common.name)) {
// 								sendCode(obj.common.name)
// 							}
// 						}
// 					});
// 				}
// 			}
// 		}
// 	}
}).on('message', function (obj) {
	if (typeof obj === 'object' && obj.command === 'browse') {
		// Send response in callback if required
		if (obj.callback) {
			var socket;
			try {
				var connection = new Broadlink();
				var list = [];
				connection.on('deviceReady', function (device) {
					list.push({ip: device.host.address, type: device.getType()});
				});
				socket = connection.discover();
			} catch (e) {
				adapter.log.error('Cannot browse: ' + e);
			}

			setTimeout(function () {
				if (socket) {
					socket.close();
					socket = null;
				}
				connection = null;
				adapter.sendTo(obj.from, obj.command, list, obj.callback);
			}, 5000);
		}
	}
}).on('ready', main);

function sendCode(value) {
	var buffer = new Buffer(value.replace(reCODE, ''), 'hex');
	//var buffer = new Buffer(value.substr(5), 'hex'); // substr(5) removes CODE_ from string

	currentDevice.sendData(buffer);
	adapter.log.debug('sendData to ' + currentDevice.host.address + ', Code: ' + value);
}

function isSignalCode(value) {
	return reIsCODE.test(value);
	//return value.length > 21 && value.substr(0, 5) == 'CODE_';

}

function enterLeaningMode(aktChannel, name) {
	var leaveTimer;
	adapter.log.info('Enter learning mode - aktChannel=' + aktChannel + ' Wait 30 seconds for data before leaving...');
	
	var timer = setInterval(function () {
		adapter.log.debug('IR-Learning-Mode - check data...');
		currentDevice.checkData();
	}, 1000);

	var leaveLearningMode = (function () {
		if (leaveTimer) {
			//clearTimeout (leaveTimer);
			leaveTimer = null;

		}
		clearInterval(timer);
		currentDevice.emitter.removeAllListeners('rawData');
		adapter.setState((aktChannel ? aktChannel + '.' : '') + 'enableLearningMode', {val: false, ack: true});
	});

	currentDevice.emitter.once('rawData', function (data) {       // use currentDevice.emitter.once, not the copy currentDevice.on. Otherwise this event will be called as often you call currentDevice.on()
		var hex = data.toString('hex');
		adapter.log.info('Learned Code - aktChannel=' + aktChannel + ' (hex): ' + hex);

		leaveLearningMode();

		var id = aktChannel ? aktChannel : namespaceChannelLearned;
		//id += '.CODE_' + hex; // see remarks at checkMigrateStates
		id += '.' + name;
		
		// Before create new object check one with the same id already exists
		adapter.getObject(id, function (err, obj) {
			if (err) {
				adapter.log.error(err);
			} else {
				var objName = obj ? obj.common.name : '';
				
				// see remarks at checkMigrateStates
				if (!obj) {
					obj = {
						type: 'state',
						common: {
							name: name ? name : defaultName,
							type: 'boolean',
							role: 'button',
							read: false,
							write: true
						},
						native: {
							code: hex
						}
					};
				} else {
					obj.native.code = hex;
				}
				adapter.setObject(id, obj, function () {
					if (!objName) {
						adapter.log.info('New IR-Code created in ' + namespaceChannelLearned);
					} else {
						adapter.log.info('IR-Code overwritten: ' + objName);
					}
				});
			}
		});
	});
	
	currentDevice.enterLearning();
	
	// Leave learning mode after 30 seconds, because the device itself has an built in timeout
	leaveTimer = setTimeout(leaveLearningMode, adapter.config.learningPeriod);
}

function createLearningModeState() {
	if (!tasks.length) {
		return;
	}
	var path = tasks.shift();
	
	var id = (path ? path + '.' : '') + 'enableLearningMode';
	
	adapter.setObject(id, {
		type: 'state',
		common: {
			name: 'Enable learning mode (30s timeout). Result saved here',
			type: 'boolean',
			role: '',
			read: false,
			write: true
		},
		native: {}
	}, function (err, obj) {
		adapter.setState(id, {val: false, ack: true}, function () {
			setTimeout(createLearningModeState, 0);
		});
	});
}

function addCode(id, obj) {
	if (obj.type !== 'state') return false;
	var code = isSignalCode(obj.common.name) ? obj.common.name.replace(reCODE, '') : (obj.native ? obj.native.code : undefined);
	if (code) codes[id] = code;
}

function checkMigrateStates(objs, cb) {
	return cb && cb(); // remove this line,
					   // if you want to move the (ir)code from the 'id' or 'name' to the obj.native.code property
					   // this function will convert all existing states with a name or id != the nativeName // '>>> Learned, please describe'
					   //
					   // the id shouldn't be used because in this case the (ir)code can change. the native object is for own, native values

	var objsArr = [];
	for (var id in objs) {
		objsArr.push(id);
	}

	var doIt = function () {
		if (objsArr.length <= 0) return cb && cb();
		var id = objsArr.pop();
		var obj = objs[id];
		if (obj.native && obj.native.code) return doIt();
		var idCode = id.replace(/.*(CODE_.*$)/, '$1');
		obj.native = obj.native || {};
		if (isSignalCode(obj.common.name)) {
			obj.native.code = obj.common.name;
			var ar = id.split('.');
			obj.common.name = ar[ar.length - 1];
			obj.common.role = 'button';
			adapter.setObject(id, obj);
		} else if (isSignalCode(idCode)) {
			obj.native.code = idCode.replace(reCODE, '');
			obj.common.role = 'button';
			if (obj.common.name === defaultName) {
				adapter.setObject(id, obj, doIt);
				return;
			}
			var newId = id.replace(/(CODE_.*$)/, obj.common.name);
			adapter.setObject(newId, obj, function (err, obj) {
				adapter.getState(id, function (err, state) {
					if (err || !state) return adapter.delObject(id, doIt);
					adapter.setState(newId, state, function (err, state) {
						adapter.delState(id, function () {
							adapter.delObject(id, doIt);
						});
					})
				})
			})
		} else {
			doIt();
		}
	};
	doIt();
}

function connect() {
	adapter.log.info('Discover UDP devices');

	var connection = new Broadlink(adapter.config.ip);

	connection.on('deviceReady', function (device) {
		if (device.host.address === adapter.config.ip) {
			if (device.checkTemperature) device.checkTemperature();

			device.emitter.on('temperature', function (temperature) {
				adapter.log.info('Device temperature: ' + temperature);
			});

			currentDevice = device;
			adapter.setState('info.connection', true, true);
			adapter.log.info('Device connected: ' + adapter.config.ip + ' (' + device.getType() + ')');

			return false;
		}
	}).discover();
}

function main() {
	if (!adapter.config.ip) {
		adapter.log.warn('No IP-Address found. Please set in configuration.');
		return;
	}

	adapter.config.learningPeriod = parseInt(adapter.config.learningPeriod, 10) || 30000;

	adapter.setState('createCode',         '',    true);
	adapter.setState('sendCode',           '',    true);
	adapter.setState('enableLearningMode', false, true);
	adapter.setState('info.connection',    false, true);

	adapter.getAdapterObjects(function (objs) {
		for (var id in objs) {
			if (objs.hasOwnProperty(id)) {
				addCode(id, objs[id]);
			}
		}
		checkMigrateStates(objs);

		adapter.subscribeStates('*');
		adapter.subscribeObjects('*');
		connect();
	});
}
