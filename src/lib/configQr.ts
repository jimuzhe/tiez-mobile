import type { MobileSyncSettings, MqttProtocol } from './sync';

export type TiezMqttQrPayload = {
  v: 1;
  type: 'tiez-mqtt';
  mqtt: {
    server?: string;
    port?: string;
    protocol?: string;
    wsPath?: string;
    username?: string;
    password?: string;
    topic?: string;
  };
};

export type TiezWebdavQrPayload = {
  v: 1;
  type: 'tiez-webdav';
  webdav: {
    url?: string;
    username?: string;
    password?: string;
    basePath?: string;
  };
};

export type ParsedConfigQr =
  | { kind: 'mqtt'; payload: TiezMqttQrPayload; warnings: string[] }
  | { kind: 'webdav'; payload: TiezWebdavQrPayload; warnings: string[] };

const asTrimmed = (value: unknown) => String(value ?? '').trim();

const normalizeMqttProtocol = (
  raw: string,
  warnings: string[]
): { protocol: MqttProtocol; portHint?: string } => {
  const protocol = raw.trim().toLowerCase();
  if (protocol === 'ws://' || protocol === 'wss://') {
    return { protocol };
  }
  if (protocol === 'mqtt://') {
    warnings.push('电脑端使用 mqtt://，手机端已改为 ws://。若连不上请确认 Broker 已开启 WebSocket 端口。');
    return { protocol: 'ws://', portHint: '8083' };
  }
  if (protocol === 'mqtts://') {
    warnings.push('电脑端使用 mqtts://，手机端已改为 wss://。若连不上请确认 Broker 已开启安全 WebSocket 端口。');
    return { protocol: 'wss://', portHint: '8084' };
  }
  return { protocol: 'wss://' };
};

export function parseTiezConfigQr(raw: string): ParsedConfigQr {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw ?? '').trim());
  } catch {
    throw new Error('不是有效的 TieZ 配置二维码');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('配置二维码格式不正确');
  }

  const data = parsed as Record<string, unknown>;
  const type = asTrimmed(data.type);
  const warnings: string[] = [];

  if (type === 'tiez-mqtt') {
    const mqtt = (data.mqtt && typeof data.mqtt === 'object' ? data.mqtt : {}) as Record<string, unknown>;
    const server = asTrimmed(mqtt.server);
    const topic = asTrimmed(mqtt.topic);
    if (!server || !topic) {
      throw new Error('MQTT 配置不完整，请确认电脑端已填写服务器和主题');
    }
    return {
      kind: 'mqtt',
      warnings,
      payload: {
        v: 1,
        type: 'tiez-mqtt',
        mqtt: {
          server,
          port: asTrimmed(mqtt.port),
          protocol: asTrimmed(mqtt.protocol) || 'wss://',
          wsPath: asTrimmed(mqtt.wsPath) || '/mqtt',
          username: asTrimmed(mqtt.username),
          password: String(mqtt.password ?? ''),
          topic,
        },
      },
    };
  }

  if (type === 'tiez-webdav') {
    const webdav = (data.webdav && typeof data.webdav === 'object' ? data.webdav : {}) as Record<string, unknown>;
    const url = asTrimmed(webdav.url);
    if (!url) {
      throw new Error('WebDAV 配置不完整，请确认电脑端已填写服务器地址');
    }
    return {
      kind: 'webdav',
      warnings,
      payload: {
        v: 1,
        type: 'tiez-webdav',
        webdav: {
          url,
          username: asTrimmed(webdav.username),
          password: String(webdav.password ?? ''),
          basePath: asTrimmed(webdav.basePath) || 'tiez-sync',
        },
      },
    };
  }

  throw new Error('请扫描电脑端 MQTT 或 WebDAV 设置里的配置二维码');
}

export function applyConfigQrToSettings(
  current: MobileSyncSettings,
  parsed: ParsedConfigQr
): { next: MobileSyncSettings; warnings: string[] } {
  const warnings = [...parsed.warnings];

  if (parsed.kind === 'mqtt') {
    const mqtt = parsed.payload.mqtt;
    const { protocol, portHint } = normalizeMqttProtocol(mqtt.protocol || 'wss://', warnings);
    const rawPort = asTrimmed(mqtt.port);
    const shouldSwapDefaultPort =
      !!portHint &&
      (!rawPort || rawPort === '1883' || rawPort === '8883' || rawPort === '80' || rawPort === '443');

    return {
      warnings,
      next: {
        ...current,
        mqttServer: asTrimmed(mqtt.server),
        mqttPort: shouldSwapDefaultPort ? portHint! : rawPort || current.mqttPort,
        mqttProtocol: protocol,
        mqttWsPath: asTrimmed(mqtt.wsPath) || '/mqtt',
        mqttUsername: asTrimmed(mqtt.username),
        mqttPassword: String(mqtt.password ?? ''),
        mqttTopic: asTrimmed(mqtt.topic),
        pushStrategy: 'mqtt',
      },
    };
  }

  const webdav = parsed.payload.webdav;
  return {
    warnings,
    next: {
      ...current,
      webdavUrl: asTrimmed(webdav.url),
      webdavUsername: asTrimmed(webdav.username),
      webdavPassword: String(webdav.password ?? ''),
      webdavBasePath: asTrimmed(webdav.basePath) || 'tiez-sync',
      pushStrategy: 'webdav',
    },
  };
}
