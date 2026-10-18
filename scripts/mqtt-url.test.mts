import assert from 'node:assert/strict';
import { buildMqttUrl } from '../src/lib/mqttUrl.ts';

const url = (mqttServer: string, mqttWsPath = '/mqtt', mqttProtocol = 'wss://') =>
    buildMqttUrl({ mqttServer, mqttPort: '8084', mqttProtocol, mqttWsPath } as any);

// Written the ways the PC accepts them, the phone reaches the same broker.
assert.equal(url('broker.example.com'), 'wss://broker.example.com:8084/mqtt');
assert.equal(url('broker.example.com:8084'), 'wss://broker.example.com:8084/mqtt');
assert.equal(url('wss://broker.example.com/mqtt'), 'wss://broker.example.com:8084/mqtt');
assert.equal(url('broker.example.com', 'mqtt'), 'wss://broker.example.com:8084/mqtt');
assert.equal(url('[::1]:8084'), 'wss://[::1]:8084/mqtt');
assert.equal(url('broker.example.com', '/mqtt', 'mqtts://'), 'mqtts://broker.example.com:8084');
console.log('mqtt url ok');
