import mqtt from 'mqtt';
import type { MobileSyncSettings } from './sync';

export async function publishToMqtt(content: string, settings: MobileSyncSettings) {
  const {
    mqttServer,
    mqttPort,
    mqttUsername,
    mqttPassword,
    mqttTopic,
    mqttProtocol,
    mqttWsPath,
    mqttClientId,
  } = settings;

  if (!mqttServer || !mqttTopic) {
    throw new Error('MQTT 配置不完整');
  }

  // 构建连接 URL
  // mqtt.js v5 在浏览器/RN 环境下会自动选择 websocket
  const host = mqttServer.replace(/^(wss?:\/\/)/, '').replace(/^(mqtts?:\/\/)/, '');
  const url = `${mqttProtocol}${host}:${mqttPort}${mqttProtocol.startsWith('ws') ? mqttWsPath : ''}`;

  console.log(`[MQTT] Connecting to ${url}...`);

  return new Promise<void>((resolve, reject) => {
    const client = mqtt.connect(url, {
      username: mqttUsername || undefined,
      password: mqttPassword || undefined,
      clientId: mqttClientId || `mobile_${Math.random().toString(16).slice(2, 10)}`,
      connectTimeout: 10000,
      reconnectPeriod: 0, 
      rejectUnauthorized: !settings.mqttTlsInsecure,
    });

    const timeout = setTimeout(() => {
      client.end(true);
      reject(new Error(`MQTT 连接超时 (${url})`));
    }, 12000);

    client.on('connect', () => {
      const payload = JSON.stringify({
        msg: content,
        sender: 'mobile',
        timestamp: Date.now(),
      });

      client.publish(mqttTopic, payload, { qos: 1 }, (err) => {
        clearTimeout(timeout);
        client.end(true);
        if (err) reject(err);
        else resolve();
      });
    });

    client.on('error', (err) => {
      const isMqttProtocol = url.startsWith('mqtt');
      let msg = err.message;
      if (isMqttProtocol && msg.includes('stream')) {
        msg += ' (当前环境可能不支持原生 MQTT 协议，建议尝试使用 ws:// 或 wss:// 协议)';
      }
      console.error('[MQTT] Error:', msg);
      clearTimeout(timeout);
      client.end(true);
      reject(new Error(`MQTT 失败: ${msg}`));
    });
  });
}

export async function publishBatchToMqtt(contents: string[], settings: MobileSyncSettings) {
  const {
    mqttServer,
    mqttPort,
    mqttUsername,
    mqttPassword,
    mqttTopic,
    mqttProtocol,
    mqttWsPath,
    mqttClientId,
  } = settings;

  if (!mqttServer || !mqttTopic) {
    throw new Error('MQTT 配置不完整');
  }

  const host = mqttServer.replace(/^(wss?:\/\/)/, '').replace(/^(mqtts?:\/\/)/, '');
  const url = `${mqttProtocol}${host}:${mqttPort}${mqttProtocol.startsWith('ws') ? mqttWsPath : ''}`;

  console.log(`[MQTT Batch] Connecting to ${url}...`);

  return new Promise<void>((resolve, reject) => {
    const client = mqtt.connect(url, {
      username: mqttUsername || undefined,
      password: mqttPassword || undefined,
      clientId: mqttClientId || `mobile_batch_${Math.random().toString(16).slice(2, 10)}`,
      connectTimeout: 12000,
      reconnectPeriod: 0,
      rejectUnauthorized: !settings.mqttTlsInsecure,
    });

    const timeout = setTimeout(() => {
      client.end(true);
      reject(new Error(`MQTT 批量推送超时 (${url})`));
    }, 12000);

    let sentCount = 0;

    client.on('connect', () => {
      const sendNext = () => {
        if (sentCount >= contents.length) {
          clearTimeout(timeout);
          client.end(true);
          resolve();
          return;
        }

        const payload = JSON.stringify({
          msg: contents[sentCount],
          sender: 'mobile',
          timestamp: Date.now(),
        });

        client.publish(mqttTopic, payload, { qos: 1 }, (err) => {
          if (err) {
            clearTimeout(timeout);
            client.end(true);
            reject(err);
            return;
          }
          sentCount++;
          sendNext();
        });
      };

      sendNext();
    });

    client.on('error', (err) => {
      const isMqttProtocol = url.startsWith('mqtt');
      let msg = err.message;
      if (isMqttProtocol && msg.includes('stream')) {
        msg += ' (当前环境可能不支持原生 MQTT 协议，建议尝试使用 ws:// 或 wss:// 协议)';
      }
      console.error('[MQTT Batch] Error:', msg);
      clearTimeout(timeout);
      client.end(true);
      reject(new Error(`MQTT 批量推送失败: ${msg} (${url})`));
    });
  });
}
