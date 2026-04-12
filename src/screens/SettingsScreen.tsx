import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  LayoutAnimation,
  Platform,
  Modal,
  Linking,
  Animated,
  Dimensions,
  UIManager,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import AboutScreen from './AboutScreen';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { useHaptics } from '../context/HapticContext';
import {
  clearLocalSyncCache,
  formatCacheSize,
  getLocalSyncCacheSize,
  loadMobileSyncSettings,
  saveMobileSyncSettings,
  type MobileSyncSettings,
  type RecentLimit,
} from '../lib/sync';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { checkUpdate } from '../lib/updateChecker';
import packageJson from '../../package.json';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function SettingsScreen() {
  const { themeMode, setThemeMode, colors } = useTheme();
  const { hapticLevel, setHapticLevel, triggerHaptic } = useHaptics();
  const insets = useSafeAreaInsets();
  const [syncSettings, setSyncSettings] = useState<MobileSyncSettings | null>(null);
  const [isSavingSyncSettings, setIsSavingSyncSettings] = useState(false);
  const [isWebDAVExpanded, setIsWebDAVExpanded] = useState(false);
  const [isMQTTExpanded, setIsMQTTExpanded] = useState(false);
  const [isHapticExpanded, setIsHapticExpanded] = useState(false);
  const [isAboutVisible, setIsAboutVisible] = useState(false);
  const [shouldRenderAbout, setShouldRenderAbout] = useState(false);
  const [localCacheSizeLabel, setLocalCacheSizeLabel] = useState('0 B');
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const sheetEntryAnim = useRef(new Animated.Value(0)).current;

  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);
  const hapticLevelRef = useRef(hapticLevel);

  const refreshLocalCacheSize = async () => {
    const bytes = await getLocalSyncCacheSize();
    setLocalCacheSizeLabel(formatCacheSize(bytes));
  };

  const toggleMQTT = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsMQTTExpanded(!isMQTTExpanded);
    if (!isMQTTExpanded) setIsWebDAVExpanded(false);
  };

  const toggleWebDAV = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    triggerHaptic();
    setIsWebDAVExpanded(!isWebDAVExpanded);
    if (!isWebDAVExpanded) setIsMQTTExpanded(false);
  };

  const toggleHapticRow = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    triggerHaptic();
    setIsHapticExpanded(!isHapticExpanded);
  };

  useEffect(() => {
    loadMobileSyncSettings().then(setSyncSettings);
    refreshLocalCacheSize().catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshLocalCacheSize().catch(() => {});
    }, [])
  );

  useEffect(() => {
    trackWidthRef.current = trackWidth;
  }, [trackWidth]);

// triggerHaptic is now from useHaptics()

  const persistSyncSettings = async (nextSettings: MobileSyncSettings) => {
    setSyncSettings(nextSettings);
    setIsSavingSyncSettings(true);
    try {
      await saveMobileSyncSettings(nextSettings);
    } finally {
      setIsSavingSyncSettings(false);
    }
  };

  const buildNextSyncSettings = (
    currentSettings: MobileSyncSettings,
    field: keyof MobileSyncSettings,
    value: string | any
  ) => {
    const nextSettings = { ...currentSettings, [field]: value };
    
    // 智能端口切换：当切换协议时，自动填充该协议常用的默认端口
    if (field === 'mqttProtocol') {
      const protocolPortMap: Record<string, string> = {
        'ws://': '8083',
        'wss://': '8084',
        'mqtt://': '1883',
        'mqtts://': '8883'
      };
      
      const currentPort = currentSettings.mqttPort;
      // 包含 80, 443 等常见默认端口在内的判定逻辑
      const commonPorts = [...Object.values(protocolPortMap), '80', '443'];
      const isDefaultOrEmpty = !currentPort || commonPorts.includes(currentPort);
      
      if (isDefaultOrEmpty) {
        nextSettings.mqttPort = protocolPortMap[value as string];
      }
    }

    return nextSettings;
  };

  const updateSyncField = async (
    field: keyof MobileSyncSettings,
    value: string | any,
    options?: { persist?: boolean }
  ) => {
    if (!syncSettings) return;
    const nextSettings = buildNextSyncSettings(syncSettings, field, value);
    setSyncSettings(nextSettings);
    if (options?.persist) {
      await persistSyncSettings(nextSettings);
    }
  };

  const saveCurrentSyncSettings = async () => {
    if (!syncSettings) return;
    triggerHaptic();
    await persistSyncSettings(syncSettings);
    Alert.alert('已保存', 'WebDAV 同步配置已经更新');
  };

  const setRecentLimit = async (limit: RecentLimit) => {
    if (!syncSettings) return;
    triggerHaptic();
    await persistSyncSettings({ ...syncSettings, recentLimit: limit });
  };

  const handleHapticDrag = (x: number) => {
    const w = trackWidthRef.current;
    if (w === 0) return;
    const clampedX = Math.max(0, Math.min(x, w - 0.1));
    const newLevel = Math.floor((clampedX / w) * 6);
    if (newLevel !== hapticLevel && newLevel >= 0 && newLevel <= 5) {
      setHapticLevel(newLevel);
      triggerHaptic(newLevel as any);
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => handleHapticDrag(evt.nativeEvent.locationX),
      onPanResponderMove: (evt) => handleHapticDrag(evt.nativeEvent.locationX),
    })
  ).current;

  const panY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isAboutVisible) {
      setShouldRenderAbout(true);
      Animated.spring(sheetEntryAnim, {
        toValue: 1,
        useNativeDriver: false,
        tension: 50,
        friction: 8,
      }).start();
    } else {
      Animated.timing(sheetEntryAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: false,
      }).start(() => setShouldRenderAbout(false));
    }
  }, [isAboutVisible]);

  const aboutPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 10,
      onPanResponderMove: Animated.event([null, { dy: panY }], { useNativeDriver: false }),
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 100) {
          setIsAboutVisible(false);
          // 这里的 panY 不需要重置，因为 sheetAnim 会处理退场
        } else {
          Animated.spring(panY, {
            toValue: 0,
            useNativeDriver: false,
          }).start();
        }
      },
    })
  ).current;

  const handleFeedback = () => {
    triggerHaptic(5);
    const qqGroup = '1038547261';
    Alert.alert(
      '意见反馈与交流',
      `欢迎加入我们的 QQ 交流群：\n${qqGroup}\n\n你可以在群内反馈问题、提出建议或是获取最新动态。`,
      [
        { text: '取消', style: 'cancel' },
        { 
          text: '复制群号', 
          onPress: async () => {
            await Clipboard.setStringAsync(qqGroup);
            triggerHaptic(2);
            Alert.alert('已复制', '群号已复制到剪贴板，快去 QQ 搜索加入吧！');
          } 
        },
        {
          text: '立即加入',
          onPress: () => {
            const url = `mqqapi://card/show_pslcard?src_type=internal&version=1&uin=${qqGroup}&card_type=group&source=qrcode`;
            Linking.canOpenURL(url).then(supported => {
              if (supported) {
                Linking.openURL(url);
              } else {
                Alert.alert('未安装 QQ', '请先安装手机 QQ 或手动搜索群号加入。');
              }
            });
          }
        }
      ]
    );
  };

  const handleCheckUpdate = async () => {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    triggerHaptic();
    try {
      await checkUpdate(true);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleClearLocalCache = () => {
    Alert.alert(
      '清理本地缓存',
      '会清空手机端已缓存的 WebDAV 拉取记录、增量游标和本地索引，但不会删除你的同步配置。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清理',
          style: 'destructive',
          onPress: async () => {
            triggerHaptic(5);
            try {
              await clearLocalSyncCache();
              await refreshLocalCacheSize();
              Alert.alert('清理成功', '本地同步缓存已清空');
            } catch (error) {
              const message = error instanceof Error ? error.message : '清理缓存失败';
              Alert.alert('清理失败', message);
            }
          },
        },
      ]
    );
  };

  const dynamicStyles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    hugeTitle: { fontSize: 36, fontWeight: '700', color: colors.text },
    card: { backgroundColor: colors.card, borderRadius: 16, overflow: 'hidden' },
    iconBox: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: colors.iconBackground,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 16,
    },
    rowText: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '400' },
    valueText: { color: colors.subText, fontSize: 17 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginLeft: 64 },
    sectionFooter: { marginTop: 8, marginLeft: 16, color: colors.subText, fontSize: 13, lineHeight: 20 },
    version: { textAlign: 'center', marginTop: 40, color: colors.subText, fontSize: 14 },
    segmentedControl: {
      flexDirection: 'row',
      backgroundColor: colors.iconBackground,
      borderRadius: 10,
      padding: 2,
    },
    segmentBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
    },
    segmentBtnActive: {
      backgroundColor: colors.card,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    segmentBtnText: { fontSize: 13, color: colors.subText, fontWeight: '500' },
    segmentBtnTextActive: { color: colors.text, fontWeight: '600' },
    input: {
      backgroundColor: colors.iconBackground,
      color: colors.text,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      marginBottom: 12,
    },
    formLabel: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 8 },
    saveButton: {
      marginTop: 6,
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      opacity: isSavingSyncSettings ? 0.75 : 1,
    },
    saveButtonText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
    aboutSheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.background,
      borderTopLeftRadius: 32,
      borderTopRightRadius: 32,
      maxHeight: '80%',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -10 },
      shadowOpacity: 0.1,
      shadowRadius: 20,
      elevation: 25,
    },
  });

  return (
    <View style={dynamicStyles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={dynamicStyles.hugeTitle}>设置</Text>
        </View>

        <View style={dynamicStyles.card}>
          <View style={[styles.row, { paddingVertical: 14 }]}>
            <View style={dynamicStyles.iconBox}>
              <Feather name="zap" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={dynamicStyles.rowText}>打开应用后自动推送</Text>
              <Text style={{ color: colors.subText, fontSize: 11 }}>检测并推送最新剪贴板内容到 PC</Text>
            </View>
            <TouchableOpacity 
              onPress={() => {
                triggerHaptic();
                updateSyncField('autoPushOnLaunch', !syncSettings?.autoPushOnLaunch as any, { persist: true });
              }}
              style={{ 
                width: 50, 
                height: 28, 
                borderRadius: 14, 
                backgroundColor: syncSettings?.autoPushOnLaunch ? colors.primary : colors.iconBackground,
                justifyContent: 'center',
                paddingHorizontal: 2
              }}
            >
              <View style={{ 
                width: 24, 
                height: 24, 
                borderRadius: 12, 
                backgroundColor: colors.primaryText,
                transform: [{ translateX: syncSettings?.autoPushOnLaunch ? 22 : 0 }]
              }} />
            </TouchableOpacity>
          </View>
          
          <View style={dynamicStyles.divider} />

          <View style={[styles.row, { paddingVertical: 14 }]}>
            <View style={dynamicStyles.iconBox}>
              <Feather name="send" size={18} color={colors.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={dynamicStyles.rowText}>推送实现策略</Text>
              <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '600' }}>MQTT 体验更好、更快速</Text>
            </View>
            <View style={dynamicStyles.segmentedControl}>
              {(['mqtt', 'webdav'] as const).map((strategy) => (
                <TouchableOpacity
                  key={strategy}
                  style={[dynamicStyles.segmentBtn, syncSettings?.pushStrategy === strategy && dynamicStyles.segmentBtnActive]}
                  onPress={() => {
                    triggerHaptic();
                    updateSyncField('pushStrategy', strategy, { persist: true });
                  }}
                >
                  <Text style={[dynamicStyles.segmentBtnText, syncSettings?.pushStrategy === strategy && dynamicStyles.segmentBtnTextActive]}>
                    {strategy === 'mqtt' ? 'MQTT' : 'WebDAV'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          
          <View style={dynamicStyles.divider} />

          <TouchableOpacity style={[styles.row, { paddingVertical: 18 }]} activeOpacity={0.7} onPress={toggleMQTT}>
            <View style={dynamicStyles.iconBox}>
              <Feather name="zap" size={18} color={colors.text} />
            </View>
            <Text style={dynamicStyles.rowText}>MQTT 推送配置</Text>
            <Text style={[dynamicStyles.valueText, { marginRight: 8, fontSize: 13 }]}>{isMQTTExpanded ? '收起' : '修改'}</Text>
            <Feather name={isMQTTExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.subText} />
          </TouchableOpacity>
          {isMQTTExpanded && (
            <View style={[styles.row, styles.blockRow, { paddingTop: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider }]}>
              <View style={{ height: 16 }} />
              <Text style={dynamicStyles.formLabel}>服务器地址 (Host)</Text>
              <TextInput value={syncSettings?.mqttServer ?? ''} onChangeText={(text) => updateSyncField('mqttServer', text)} placeholder="broker.emqx.io" placeholderTextColor={colors.subText} style={dynamicStyles.input} autoCapitalize="none" autoCorrect={false} />
              
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={dynamicStyles.formLabel}>端口</Text>
                  <TextInput value={syncSettings?.mqttPort ?? ''} onChangeText={(text) => updateSyncField('mqttPort', text)} placeholder="8883" placeholderTextColor={colors.subText} style={dynamicStyles.input} keyboardType="numeric" />
                </View>
                <View style={{ flex: 2 }}>
                  <Text style={dynamicStyles.formLabel}>协议</Text>
                  <View style={[dynamicStyles.segmentedControl, { height: 44 }]}>
                    {(['ws://', 'wss://'] as const).map((p) => (
                      <TouchableOpacity 
                        key={p} 
                        style={[
                          dynamicStyles.segmentBtn, 
                          syncSettings?.mqttProtocol === p && dynamicStyles.segmentBtnActive,
                          { flex: 1, justifyContent: 'center', alignItems: 'center' }
                        ]} 
                        onPress={() => updateSyncField('mqttProtocol', p)}
                      >
                        <Text style={[
                          dynamicStyles.segmentBtnText, 
                          syncSettings?.mqttProtocol === p && dynamicStyles.segmentBtnTextActive,
                        ]}>
                          {p.replace('://', '')}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              <Text style={dynamicStyles.formLabel}>用户名 (可选)</Text>
              <TextInput value={syncSettings?.mqttUsername ?? ''} onChangeText={(text) => updateSyncField('mqttUsername', text)} placeholder="Username" placeholderTextColor={colors.subText} style={dynamicStyles.input} autoCapitalize="none" autoCorrect={false} />
              <Text style={dynamicStyles.formLabel}>密码 (可选)</Text>
              <TextInput value={syncSettings?.mqttPassword ?? ''} onChangeText={(text) => updateSyncField('mqttPassword', text)} placeholder="Password" placeholderTextColor={colors.subText} style={dynamicStyles.input} secureTextEntry autoCapitalize="none" autoCorrect={false} />
              
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={dynamicStyles.formLabel}>WS 路径</Text>
                  <TextInput value={syncSettings?.mqttWsPath ?? '/mqtt'} onChangeText={(text) => updateSyncField('mqttWsPath', text)} placeholder="/mqtt" placeholderTextColor={colors.subText} style={dynamicStyles.input} autoCapitalize="none" autoCorrect={false} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={dynamicStyles.formLabel}>客户端 ID</Text>
                    <TouchableOpacity onPress={() => {
                        triggerHaptic();
                        updateSyncField('mqttClientId', `tiez_mobile_${Math.random().toString(36).substring(2, 10)}`);
                    }} style={{ marginBottom: 8, paddingHorizontal: 4 }}>
                      <Feather name="refresh-cw" size={12} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                  <TextInput value={syncSettings?.mqttClientId ?? ''} onChangeText={(text) => updateSyncField('mqttClientId', text)} placeholder="Mobile-Device" placeholderTextColor={colors.subText} style={dynamicStyles.input} autoCapitalize="none" autoCorrect={false} />
                </View>
              </View>


              <Text style={dynamicStyles.formLabel}>推送主题 (Topic)</Text>
              <TextInput value={syncSettings?.mqttTopic ?? ''} onChangeText={(text) => updateSyncField('mqttTopic', text)} placeholder="tiez/your-unique-topic" placeholderTextColor={colors.subText} style={dynamicStyles.input} autoCapitalize="none" autoCorrect={false} />
              
              <TouchableOpacity style={dynamicStyles.saveButton} activeOpacity={0.8} onPress={saveCurrentSyncSettings}>
                <Text style={dynamicStyles.saveButtonText}>{isSavingSyncSettings ? '保存中...' : '保存 MQTT 配置'}</Text>
              </TouchableOpacity>
              <View style={{ height: 12 }} />
            </View>
          )}

          <View style={dynamicStyles.divider} />

          <TouchableOpacity style={[styles.row, { paddingVertical: 18 }]} activeOpacity={0.7} onPress={toggleWebDAV}>
            <View style={dynamicStyles.iconBox}>
              <Feather name="server" size={18} color={colors.text} />
            </View>
            <Text style={dynamicStyles.rowText}>WebDAV 同步配置</Text>
            <Text style={[dynamicStyles.valueText, { marginRight: 8, fontSize: 13 }]}>{isWebDAVExpanded ? '收起' : '修改'}</Text>
            <Feather name={isWebDAVExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.subText} />
          </TouchableOpacity>
          {isWebDAVExpanded && (
            <View style={[styles.row, styles.blockRow, { paddingTop: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider }]}>
              <View style={{ height: 16 }} />
              <Text style={dynamicStyles.formLabel}>服务器地址</Text>
              <TextInput value={syncSettings?.webdavUrl ?? ''} onChangeText={(text) => updateSyncField('webdavUrl', text)} placeholder="https://dav.example.com" placeholderTextColor={colors.subText} style={dynamicStyles.input} autoCapitalize="none" autoCorrect={false} />
              <Text style={dynamicStyles.formLabel}>用户名</Text>
              <TextInput value={syncSettings?.webdavUsername ?? ''} onChangeText={(text) => updateSyncField('webdavUsername', text)} placeholder="your-username" placeholderTextColor={colors.subText} style={dynamicStyles.input} autoCapitalize="none" autoCorrect={false} />
              <Text style={dynamicStyles.formLabel}>密码</Text>
              <TextInput value={syncSettings?.webdavPassword ?? ''} onChangeText={(text) => updateSyncField('webdavPassword', text)} placeholder="WebDAV Password" placeholderTextColor={colors.subText} style={dynamicStyles.input} secureTextEntry autoCapitalize="none" autoCorrect={false} />
              <Text style={dynamicStyles.formLabel}>基础路径</Text>
              <TextInput value={syncSettings?.webdavBasePath ?? ''} onChangeText={(text) => updateSyncField('webdavBasePath', text)} placeholder="tiez-sync" placeholderTextColor={colors.subText} style={[dynamicStyles.input, { marginBottom: 4 }]} autoCapitalize="none" autoCorrect={false} />
              <TouchableOpacity style={dynamicStyles.saveButton} activeOpacity={0.8} onPress={saveCurrentSyncSettings}>
                <Text style={dynamicStyles.saveButtonText}>{isSavingSyncSettings ? '保存中...' : '保存同步配置'}</Text>
              </TouchableOpacity>
              <View style={{ height: 12 }} />
            </View>
          )}
          <View style={dynamicStyles.divider} />
          <View style={styles.row}>
            <View style={dynamicStyles.iconBox}>
              <Feather name="clock" size={18} color={colors.text} />
            </View>
            <Text style={dynamicStyles.rowText}>拉取剪贴板最近数量</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.iconBackground, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
              <TextInput
                value={String(syncSettings?.recentLimit ?? 10)}
                onChangeText={(text) => {
                  const val = parseInt(text.replace(/[^0-9]/g, ''), 10);
                  setRecentLimit(isNaN(val) ? 0 : val);
                }}
                keyboardType="numeric"
                style={{ 
                  color: colors.text, 
                  fontSize: 16, 
                  fontWeight: '600', 
                  padding: 0, 
                  minWidth: 40, 
                  textAlign: 'center' 
                }}
              />
              <Text style={{ color: colors.subText, fontSize: 13, marginLeft: 4 }}>条</Text>
            </View>
          </View>
          <View style={dynamicStyles.divider} />
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={handleClearLocalCache}>
            <View style={dynamicStyles.iconBox}>
              <Feather name="trash-2" size={18} color={colors.text} />
            </View>
            <Text style={dynamicStyles.rowText}>清理本地缓存</Text>
            <Text style={dynamicStyles.valueText}>{localCacheSizeLabel}</Text>
          </TouchableOpacity>
        </View>

        <View style={[dynamicStyles.card, { marginTop: 24 }]}>
          <View style={styles.row}>
            <View style={dynamicStyles.iconBox}>
              <Feather name="sun" size={18} color={colors.text} />
            </View>
            <Text style={dynamicStyles.rowText}>主题背景</Text>
            <View style={dynamicStyles.segmentedControl}>
              {(['Light', 'Dark', 'System'] as const).map((mode) => (
                <TouchableOpacity key={mode} style={[dynamicStyles.segmentBtn, themeMode === mode && dynamicStyles.segmentBtnActive]} onPress={() => { triggerHaptic(); setThemeMode(mode); }}>
                  <Text style={[dynamicStyles.segmentBtnText, themeMode === mode && dynamicStyles.segmentBtnTextActive]}>{mode === 'Light' ? '浅色' : mode === 'Dark' ? '深色' : '系统'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={dynamicStyles.divider} />
          <TouchableOpacity style={[styles.row, { paddingVertical: 18 }]} activeOpacity={0.7} onPress={toggleHapticRow}>
            <View style={dynamicStyles.iconBox}>
              <Feather name="smartphone" size={18} color={colors.text} />
            </View>
            <Text style={dynamicStyles.rowText}>触感反馈强度</Text>
            <Text style={[dynamicStyles.valueText, { marginRight: 8, fontSize: 13 }]}>{hapticLevel === 0 ? '已关闭' : `${hapticLevel} 档`}</Text>
            <Feather name={isHapticExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.subText} />
          </TouchableOpacity>
          {isHapticExpanded && (
            <View style={[styles.row, styles.blockRow, { paddingTop: 0, borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <View style={{ height: 16 }} />
              <View style={styles.segmentedSlider} onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)} {...panResponder.panHandlers}>
                {[0, 1, 2, 3, 4, 5].map((level) => (
                  <View key={level} style={styles.segmentTouch} pointerEvents="none">
                    <View style={[styles.segmentBar, { backgroundColor: level === 0 ? 'transparent' : hapticLevel >= level ? colors.primary : colors.divider, borderTopLeftRadius: level === 1 ? 4 : 0, borderBottomLeftRadius: level === 1 ? 4 : 0, borderTopRightRadius: level === 5 ? 4 : 0, borderBottomRightRadius: level === 5 ? 4 : 0 }]}>
                      {level === 0 && <Text style={{ color: hapticLevel === 0 ? colors.text : colors.subText, fontSize: 13, fontWeight: '600', marginLeft: -8 }}>关</Text>}
                    </View>
                  </View>
                ))}
              </View>
              <View style={{ height: 16 }} />
            </View>
          )}
        </View>

        <View style={[dynamicStyles.card, { marginTop: 24 }]}>
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={handleFeedback}>
            <View style={dynamicStyles.iconBox}>
              <Feather name="message-square" size={18} color={colors.text} />
            </View>
            <Text style={dynamicStyles.rowText}>意见反馈</Text>
            <Feather name="chevron-right" size={20} color={colors.subText} />
          </TouchableOpacity>
          <View style={dynamicStyles.divider} />
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => { triggerHaptic(); setIsAboutVisible(true); }}>
            <View style={dynamicStyles.iconBox}>
              <Feather name="info" size={18} color={colors.text} />
            </View>
            <Text style={dynamicStyles.rowText}>关于 TieZ</Text>
            <Feather name="chevron-right" size={20} color={colors.subText} />
          </TouchableOpacity>
          <View style={dynamicStyles.divider} />
          <TouchableOpacity 
            style={styles.row} 
            activeOpacity={0.7} 
            onPress={handleCheckUpdate}
            disabled={isCheckingUpdate}
          >
            <View style={dynamicStyles.iconBox}>
              <Feather name="arrow-up-circle" size={18} color={colors.text} />
            </View>
            <Text style={dynamicStyles.rowText}>检查更新</Text>
            {isCheckingUpdate ? (
              <ActivityIndicator size="small" color={colors.subText} style={{ marginRight: 8 }} />
            ) : (
              <Feather name="chevron-right" size={20} color={colors.subText} />
            )}
          </TouchableOpacity>
        </View>

        <Text style={dynamicStyles.version}>TieZ v{packageJson.version}</Text>
        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal 
        visible={shouldRenderAbout} 
        transparent 
        animationType="none"
        onRequestClose={() => setIsAboutVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Animated.View 
            style={[
              StyleSheet.absoluteFill, 
              { 
                backgroundColor: 'black', 
                opacity: sheetEntryAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 0.4]
                })
              }
            ]} 
          >
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setIsAboutVisible(false)} />
          </Animated.View>

          <Animated.View 
            {...aboutPanResponder.panHandlers}
            style={[
              dynamicStyles.aboutSheet, 
              { 
                paddingBottom: Math.max(20, insets.bottom),
                transform: [
                  { 
                    translateY: Animated.add(
                      panY,
                      sheetEntryAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [SCREEN_HEIGHT, 0]
                      })
                    )
                  }
                ]
              }
            ]}
          >
            <AboutScreen />
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingTop: 80, paddingHorizontal: 20 },
  header: { marginBottom: 30 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  blockRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  segmentedSlider: {
    flexDirection: 'row',
    height: 40,
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  segmentTouch: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
  },
  segmentBar: {
    height: 8,
    marginHorizontal: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
});
