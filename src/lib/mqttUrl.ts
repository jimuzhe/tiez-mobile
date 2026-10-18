import type { MobileSyncSettings } from './sync';

/**
 * Broker URL from the settings, reading the server field as the PC does
 * (mqtt_sub.rs): a scheme, path or port typed into it is dropped (the port
 * field wins), and the WebSocket path gets its leading "/". The QR code passes
 * the field as typed on the PC, which accepts all of these.
 */
export function buildMqttUrl(
    settings: Pick<MobileSyncSettings, 'mqttServer' | 'mqttPort' | 'mqttProtocol' | 'mqttWsPath'>
) {
    let host = settings.mqttServer.trim().replace(/^(wss?|mqtts?):\/\//i, '').split('/')[0];
    if (host.startsWith('[')) {
        const end = host.lastIndexOf(']:');
        if (end >= 0 && /^\d+$/.test(host.slice(end + 2))) host = host.slice(0, end + 1);
    } else {
        const colon = host.lastIndexOf(':');
        if (colon >= 0 && /^\d+$/.test(host.slice(colon + 1))) host = host.slice(0, colon);
    }
    const wsPath = settings.mqttWsPath || '';
    const path = settings.mqttProtocol.startsWith('ws')
        ? (wsPath.startsWith('/') ? wsPath : `/${wsPath}`)
        : '';
    return `${settings.mqttProtocol}${host}:${settings.mqttPort}${path}`;
}
